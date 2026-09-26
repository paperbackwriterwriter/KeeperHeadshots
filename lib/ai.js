// The two AI halves of a shoot:
//   Claude  — looks at the selfies (quality check) and later grades the results.
//   Gemini  — the image model that actually renders each headshot from the selfies.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";

export function aiStatus() {
  return {
    vision: !!process.env.ANTHROPIC_API_KEY,
    imaging: !!process.env.GEMINI_API_KEY,
    visionModel: CLAUDE_MODEL,
    imageModel: IMAGE_MODEL,
  };
}

let anthropic;
let gemini;
const claude = () => (anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
const genai = () =>
  (gemini ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}),
  }));

export class AIError extends Error {
  constructor(message, { status = 502, retryable = true } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

function friendlyAnthropicError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new AIError("The Claude API key was rejected. Check ANTHROPIC_API_KEY.", { status: 500, retryable: false });
  if (err instanceof Anthropic.RateLimitError) return new AIError("Our photo reviewer is busy right now. Try again in a minute.", { status: 429 });
  if (err instanceof Anthropic.BadRequestError) return new AIError(`Claude couldn't read these photos: ${err.message}`, { status: 400, retryable: false });
  if (err instanceof Anthropic.APIConnectionError) return new AIError("Couldn't reach Claude. Check your connection and try again.");
  if (err instanceof Anthropic.APIError) return new AIError(`Claude returned an error (${err.status}). Try again.`);
  return err;
}

const img = (photo) => ({ type: "image", source: { type: "base64", media_type: photo.mime, data: photo.data } });

async function askClaude({ system, content, schema, effort = "medium" }) {
  let res;
  try {
    res = await claude().beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      // Server-side fallback: if a safety classifier declines, the API re-runs
      // the request on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    throw friendlyAnthropicError(err);
  }
  if (res.stop_reason === "refusal") {
    throw new AIError("These photos couldn't be reviewed. Please upload clear, everyday photos of yourself.", { status: 422, retryable: false });
  }
  if (res.stop_reason === "max_tokens" || !res.parsed_output) {
    throw new AIError("The photo review came back incomplete. Please try again.");
  }
  return res.parsed_output;
}

/* ------------------------------------------------------------------ */
/* 1. Selfie check                                                     */
/* ------------------------------------------------------------------ */

const Score = z.number().describe("0-10, where 10 is ideal");

const CheckSchema = z.object({
  overall_score: z.number().describe("0-100 readiness of the whole set for AI headshot generation"),
  verdict: z.enum(["ready", "usable", "retake"]),
  headline: z.string().describe("One confident sentence, max 12 words"),
  summary: z.string().describe("2-3 sentences, warm and specific, addressed to the person as 'you'"),
  subject: z.object({
    description: z
      .string()
      .describe("Visible, non-sensitive appearance notes that help preserve likeness: hair colour/length/texture/style, facial hair, glasses, notable features like freckles. No guesses about ethnicity, age, health or other sensitive traits."),
    glasses: z.boolean(),
  }),
  photos: z.array(
    z.object({
      index: z.number().describe("0-based index matching the upload order"),
      score: z.number().describe("0-100"),
      keep: z.boolean().describe("Whether to use this photo as a reference for generation"),
      lighting: Score,
      sharpness: Score,
      face_visibility: Score,
      expression: Score,
      issues: z.array(z.string()).describe("Short issue labels, e.g. 'Sunglasses', 'Heavy filter', 'Face too small'. Empty if none."),
      note: z.string().describe("One short sentence about this photo"),
    }),
  ),
  tips: z.array(z.string()).describe("Up to 3 concrete, actionable tips to improve the set; empty if already great"),
});

const CHECK_SYSTEM = `You are the photo-intake specialist at AI Headshot Guru, an AI headshot studio. People upload casual selfies and you decide whether they'll produce great professional headshots.

What makes a good reference photo: one person clearly visible, face large enough in frame, eyes open and unobstructed (no sunglasses, no hands over face), in focus, reasonably even lighting without harsh shadows, no heavy beauty filters, varied angles and expressions across the set. Glasses are fine if the person normally wears them.

Score honestly. "ready" = generate now; "usable" = will work but could be better; "retake" = not enough good photos (e.g. no visible face, blurred, a group photo with no clear subject, not a person). Mark keep=false on photos that would hurt likeness (wrong person, face hidden, extreme blur). Write like a friendly, expert photographer: specific, encouraging, never robotic. Never comment on attractiveness, weight, or body.`;

export async function checkSelfies(photos) {
  const content = [];
  photos.forEach((p, i) => {
    content.push({ type: "text", text: `Photo ${i} of ${photos.length}:` });
    content.push(img(p));
  });
  content.push({ type: "text", text: "Review this set of reference selfies. Return one entry in `photos` per photo, in order." });
  const out = await askClaude({ system: CHECK_SYSTEM, content, schema: CheckSchema });
  const clamp = (n, hi) => Math.max(0, Math.min(hi, Math.round(n)));
  out.overall_score = clamp(out.overall_score, 100);
  out.photos = out.photos
    .filter((p) => p.index >= 0 && p.index < photos.length)
    .map((p) => ({
      ...p,
      score: clamp(p.score, 100),
      lighting: clamp(p.lighting, 10),
      sharpness: clamp(p.sharpness, 10),
      face_visibility: clamp(p.face_visibility, 10),
      expression: clamp(p.expression, 10),
    }));
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Generation                                                       */
/* ------------------------------------------------------------------ */

const TAKE_DIRECTION = [
  "Head and shoulders, body angled slightly, face turned to camera, a relaxed confident closed-mouth smile.",
  "Tight head-and-shoulders crop, square to camera, a warm natural smile showing a little teeth, approachable.",
  "Chest-up framing, slight three-quarter turn, calm and self-assured expression, subtle smile.",
];

export function buildPrompt({ look, take, subject }) {
  return [
    "Create a professional corporate headshot photograph of the exact same person shown in the reference photos.",
    "Preserve their identity precisely: face shape, facial features, skin tone and texture, eye colour, hairline, and hair colour/texture must match the reference photos. Do not beautify, slim or age them. Keep any glasses and facial hair they have.",
    subject?.description ? `Reference notes: ${subject.description}` : "",
    `Wardrobe: ${look.outfit.prompt}, well fitted and neatly pressed.`,
    `Setting: ${look.backdrop.prompt}.`,
    TAKE_DIRECTION[take % TAKE_DIRECTION.length],
    "Shot on a full-frame camera with an 85mm portrait lens, natural skin detail, flattering professional retouching only, sharp focus on the eyes, photorealistic, no text, no watermark, a single person only.",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function generateHeadshot({ references, prompt }) {
  let res;
  try {
    res = await genai().models.generateContent({
      model: IMAGE_MODEL,
      contents: [
        {
          role: "user",
          parts: [...references.map((r) => ({ inlineData: { mimeType: r.mime, data: r.data } })), { text: prompt }],
        },
      ],
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "3:4" },
      },
    });
  } catch (err) {
    const status = err?.status || err?.code;
    if (status === 401 || status === 403) throw new AIError("The Gemini API key was rejected. Check GEMINI_API_KEY.", { status: 500, retryable: false });
    if (status === 429) throw new AIError("The image studio is at capacity. Retrying shortly.", { status: 429 });
    if (status === 404) throw new AIError(`Image model "${IMAGE_MODEL}" isn't available on this key. Set GEMINI_IMAGE_MODEL.`, { status: 500, retryable: false });
    throw new AIError(`The image model failed: ${err?.message || "unknown error"}`);
  }
  const parts = res?.candidates?.[0]?.content?.parts || [];
  const image = parts.find((p) => p.inlineData?.data);
  if (!image) {
    const reason = res?.candidates?.[0]?.finishReason || res?.promptFeedback?.blockReason;
    throw new AIError(reason ? `No image returned (${reason}).` : "The image model returned no image.");
  }
  return { mime: image.inlineData.mimeType || "image/png", data: Buffer.from(image.inlineData.data, "base64") };
}

/* ------------------------------------------------------------------ */
/* 3. Review of the finished shots                                     */
/* ------------------------------------------------------------------ */

const ReviewSchema = z.object({
  best_shot_index: z.number().describe("0-based index of the single best headshot"),
  headline: z.string().describe("A short, confident verdict on the shoot, max 10 words"),
  summary: z.string().describe("2-3 sentences addressed to the person as 'you': what worked, which looks suit them best"),
  shots: z.array(
    z.object({
      index: z.number(),
      likeness: Score.describe("How closely the headshot matches the person in the references"),
      polish: Score.describe("Professional finish: wardrobe, retouching, absence of AI artifacts (hands, ears, teeth, fabric)"),
      lighting: Score,
      overall: z.number().describe("0-100"),
      grade: z.enum(["keeper", "solid", "retake"]),
      best_for: z.string().describe("Where this shot works best, e.g. 'LinkedIn', 'Company site', 'Speaker bio', 'Conference badge'"),
      note: z.string().describe("One specific sentence, e.g. what makes it work or the artifact to watch for"),
    }),
  ),
});

const REVIEW_SYSTEM = `You are the senior retoucher at AI Headshot Guru reviewing a finished AI headshot shoot before it's delivered. You see the person's original reference selfies first, then the generated headshots.

Grade each headshot honestly: likeness to the references matters most (a beautiful photo of someone else is a 'retake'), then professional polish (watch for AI artifacts: warped ears, extra fingers, melted collars, mismatched eyes, plastic skin), then lighting. 'keeper' = ready for LinkedIn today, 'solid' = good with a small caveat, 'retake' = don't use. Pick exactly one best shot. Be specific and encouraging; never comment on attractiveness or body.`;

export async function reviewShots({ references, shots }) {
  const content = [{ type: "text", text: "Reference selfies of the person:" }];
  references.forEach((r) => content.push(img(r)));
  content.push({ type: "text", text: `Generated headshots (${shots.length}):` });
  shots.forEach((s, i) => {
    content.push({ type: "text", text: `Headshot ${i} — ${s.label}:` });
    content.push(img(s));
  });
  content.push({ type: "text", text: "Grade every headshot, one entry per headshot in order, and pick the best." });
  const out = await askClaude({ system: REVIEW_SYSTEM, content, schema: ReviewSchema });
  out.best_shot_index = Math.max(0, Math.min(shots.length - 1, Math.round(out.best_shot_index)));
  return out;
}
