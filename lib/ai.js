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

// Operator detail goes to the logs; customers get a plain message.
function friendlyAnthropicError(err) {
  if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) console.error("[claude]", err.status ?? "", err.message);
  if (err instanceof Anthropic.AuthenticationError) return new AIError("The AI studio is temporarily unavailable. Please try again later.", { status: 503, retryable: false });
  if (err instanceof Anthropic.RateLimitError) return new AIError("Our photo check is busy right now. Try again in a minute.", { status: 429 });
  if (err instanceof Anthropic.BadRequestError) return new AIError("We couldn't read these photos. Try different JPG or PNG photos.", { status: 400, retryable: false });
  if (err instanceof Anthropic.APIConnectionError) return new AIError("We couldn't reach the AI studio. Please try again.");
  if (err instanceof Anthropic.APIError) return new AIError("The AI studio hit a temporary problem. Please try again.");
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
      .describe("A precise, visual likeness description an image model can use to reproduce this exact face (3-5 sentences): face shape and proportions, jawline and chin, eye shape and colour, brows, nose shape, lips and smile (including teeth when visible), ears, hairline, hair colour/texture/length/parting, facial hair, glasses, skin tone in neutral photographic terms, and distinguishing details such as freckles, moles, dimples or laugh lines. Describe only what is visible; no guesses about ethnicity, age, health or other sensitive traits."),
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

const CHECK_SYSTEM = `You are the photo-intake specialist at Keeper Headshots, an AI headshot studio. People upload casual selfies and you decide whether they'll produce great professional headshots.

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

// Each take in a look gets its own pose and expression, like a photographer
// working through a set.
const TAKE_DIRECTION = [
  "Pose: shoulders angled about 30 degrees away from the camera with the face turned back toward the lens, chin slightly forward and down, posture tall and relaxed. Expression: a relaxed, confident closed-mouth smile that reaches the eyes.",
  "Pose: body turned slightly (about 20 degrees) from the camera, head level and facing the lens, posture open and relaxed. Expression: a soft, natural smile — lips closed or only slightly parted, never a broad grin — with warm, engaged eyes.",
  "Pose: a gentle three-quarter turn of the body with the head turned to the camera, shoulders relaxed and level. Expression: calm and self-assured, with a subtle smile and a direct, confident gaze.",
]

// The wardrobe, set, pose and camera part of a brief, shared by every render.
export function sceneBrief({ look, take }) {
  return [
    `Wardrobe: ${look.outfit.prompt}. Neatly pressed and well fitted, no logos.`,
    `Background: ${look.backdrop.prompt}. Lighting: ${look.backdrop.light}. Describe the light only by its effect on the person: every light, reflector and modifier is outside the frame and never appears in the picture.`,
    TAKE_DIRECTION[take % TAKE_DIRECTION.length],
    "Photography: an 85mm portrait lens at about f/2.8 from eye level; a vertical head-and-shoulders crop ending around mid-chest with a little space above the head; tack-sharp eyes with clear catchlights; natural colour and real skin texture with only light professional retouching; photorealistic, like a real portrait session. The backdrop fills the whole frame edge to edge: no studio equipment, light stands, softboxes, umbrellas or reflectors visible. One person only, no hands in frame, no text, logos or watermarks.",
  ];
}

// The brief sent to the image model with the reference selfies. Framed as an
// edit of the person in the photos: the face comes from the photos only.
// (A written description of the face made the model invent lookalikes, so
// none is included.)
export function buildPrompt({ look, take, subject }) {
  const glasses = subject?.glasses ? " Keep their glasses, with clean lenses and no glare over the eyes." : "";
  return [
    `Create a professional headshot of the person in the reference photos above. It must be the same real person: keep their face exactly as it is in the photos — the same facial structure, features, skin, hair, hairline and apparent age — so anyone who knows them recognises them instantly. Treat their face as fixed and change only the clothing, background, lighting, pose and camera. Do not create a new, different or idealised face, and do not slim, smooth or beautify them.${glasses}`,
    "Keep the face's exact proportions from the photos: the same face width and length, jawline, cheeks, chin and nose size. Do not widen, round, flatten or stretch the face, and avoid any wide-angle or lens distortion; a gentle, natural smile that doesn't change the face shape.",
    ...sceneBrief({ look, take }),
  ].join("\n\n");
}

export async function generateHeadshot({ references, prompt }) {
  let res;
  try {
    res = await genai().models.generateContent({
      model: IMAGE_MODEL,
      contents: [
        {
          role: "user",
          // No references: a text-only render (used for the site's example images).
          parts: references.length
            ? [
                { text: `Reference photos of the person (${references.length}); the first is the clearest:` },
                ...references.map((r) => ({ inlineData: { mimeType: r.mime, data: r.data } })),
                { text: prompt },
              ]
            : [{ text: prompt }],
        },
      ],
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "3:4" },
      },
    });
  } catch (err) {
    const status = err?.status || err?.code;
    console.error("[gemini]", status ?? "", err?.message);
    if (status === 401 || status === 403 || status === 404) throw new AIError("The image studio is temporarily unavailable. Retry this frame later.", { status: 503, retryable: false });
    if (status === 429) throw new AIError("The image studio is at capacity. Retrying shortly.", { status: 429 });
    throw new AIError("This frame couldn't be developed. Retry it in a moment.");
  }
  const parts = res?.candidates?.[0]?.content?.parts || [];
  const image = parts.find((p) => p.inlineData?.data);
  if (!image) {
    const reason = res?.candidates?.[0]?.finishReason || res?.promptFeedback?.blockReason;
    if (reason) console.warn("[gemini] no image:", reason);
    throw new AIError("This frame came back empty. Retry it in a moment.");
  }
  return { mime: image.inlineData.mimeType || "image/png", data: Buffer.from(image.inlineData.data, "base64") };
}

/* ------------------------------------------------------------------ */
/* 2b. Quality gate: every frame is checked before anyone sees it      */
/* ------------------------------------------------------------------ */

const QaSchema = z.object({
  likeness: Score.describe("How unmistakably this is the same person as in the references. 10 = a friend would recognise them instantly; 8 = clearly them with only trivial drift; 6 or below = looks like a relative or a different person"),
  likeness_notes: z.string().describe("One or two sentences naming the specific features compared and any drift (face width, jaw, eyes, nose, mouth, hairline, skin tone, apparent age, glasses)"),
  professional: Score.describe("Would a top portrait studio deliver this as-is? 10 = flawless; 8 = excellent with nothing a client would notice; 6 or below = visible flaws"),
  issues: z.array(
    z.object({
      kind: z.enum(["likeness", "anatomy", "artifact", "hands", "wardrobe", "background", "lighting", "framing", "expression", "equipment", "text_or_watermark", "extra_person", "other"]),
      severity: z.enum(["blocking", "minor"]),
      detail: z.string().describe("Specific and visual, e.g. 'left ear is fused into the hair', 'collar points are melted'"),
    }),
  ).describe("Every problem you can see. Empty only if the image is genuinely flawless."),
  pass: z.boolean().describe("True only if this headshot is ready to hand to a paying client with no edits"),
  retake_direction: z.string().describe("If not passing: one or two concrete instructions for the next render that would fix the problems (e.g. 'keep the jaw as wide as in the references; the collar must have two clean points'). Empty if passing."),
});

const QA_SYSTEM = `You are the final quality gate at Keeper Headshots, a premium portrait studio. A generated headshot only reaches the client if you pass it. Be exacting: it is far better to send a frame back for a retake than to deliver one the client would be disappointed by.

You see the client's reference photos first, then one candidate headshot and the look it was meant to have.

1. Likeness (most important). Study the references: face shape and width, jawline and chin, cheekbones, eye shape, colour and spacing, brows, nose width and length, lips and smile, teeth if visible, ears, hairline, hair colour and texture, facial hair, glasses, skin tone and texture, freckles, moles and other distinguishing marks, apparent age. Compare the candidate feature by feature. Any of these is blocking: a narrower or wider face, a changed nose or jaw, different eyes, lighter or darker skin, a younger or "idealised model" look, missing or added glasses, a changed hairline. If you have to ask "is that them?", it fails.
2. Professional finish. Blocking: warped or fused ears, odd teeth, asymmetric or mismatched eyes, plastic or waxy skin, extra or malformed fingers or any hands in frame, melted or impossible clothing (collars, lapels, buttons), a second person, text, logos or watermarks, visible studio equipment, strange background objects, heavy blur on the eyes, blown-out or muddy lighting, an awkward crop that cuts the head or chin. Also check it matches the requested look: the outfit and backdrop should be clearly what was asked for.
3. Minor issues (slightly soft hair edge, a small wrinkle) don't fail a frame on their own, but list them.

Pass only when likeness is 8 or higher, professional is 8 or higher and there are no blocking issues. Never comment on attractiveness or body; judge likeness and craft only.`;

export async function qaHeadshot({ references, candidate, look }) {
  const content = [{ type: "text", text: `Reference photos of the client (${references.length}):` }];
  references.forEach((r) => content.push(img(r)));
  content.push({ type: "text", text: `Candidate headshot. Requested look: ${look.backdrop.name} backdrop, ${look.outfit.name}.` });
  content.push(img(candidate));
  content.push({ type: "text", text: "Inspect it closely and return your verdict." });
  const qa = await askClaude({ system: QA_SYSTEM, content, schema: QaSchema, effort: "high" });
  const blocking = qa.issues.filter((i) => i.severity === "blocking");
  // The code enforces the bar too, so a lenient "pass" can't slip through.
  return { ...qa, passed: qa.pass && qa.likeness >= 8 && qa.professional >= 8 && blocking.length === 0 };
}

/* ------------------------------------------------------------------ */
/* 3. Review of the finished shots                                     */
/* ------------------------------------------------------------------ */

const ReviewSchema = z.object({
  best_frame: z.number().describe("The frame number (as labelled, e.g. 3 for 'Frame 03') of the single headshot you recommend most — it will be featured as the best pick"),
  headline: z.string().describe("Max 10 words, about the recommended frame and why it works. Must describe that specific photo."),
  summary: z.string().describe("2-3 sentences addressed to the person as 'you'. Lead with why the recommended frame works (its look, expression, likeness), then one line of guidance on the rest. Refer to other photos only as 'frame NN' or by their look name; never use any other numbering."),
  shots: z.array(
    z.object({
      frame: z.number().describe("The frame number exactly as labelled"),
      likeness: Score.describe("How unmistakably this is the same person as in the references"),
      polish: Score.describe("Professional finish: wardrobe, retouching, absence of AI artifacts (hands, ears, teeth, fabric)"),
      lighting: Score,
      overall: z.number().describe("0-100, weighted about 55% likeness, 30% polish, 15% lighting. Likeness below 7 caps overall at 70."),
      grade: z.enum(["keeper", "solid", "retake"]),
      best_for: z.string().describe("Where this shot works best, e.g. 'LinkedIn', 'Company site', 'Speaker bio', 'Conference badge'"),
      note: z.string().describe("One specific sentence, e.g. what makes it work or the artifact to watch for"),
    }),
  ),
});

const REVIEW_SYSTEM = `You are the senior retoucher at Keeper Headshots reviewing a finished AI headshot shoot before it's delivered. You see the person's original reference selfies first, then the generated headshots.

Work in this order:
1. Study the reference selfies closely and note the person's distinctive features: face shape and width, jawline and chin, eye shape and spacing, brows, nose shape, mouth and teeth, hairline and hair texture, skin tone, any glasses or facial hair.
2. Compare every headshot against those specific features. Likeness is the whole point: someone who knows this person should instantly recognise them. Small drifts add up — a slimmer face, a different nose, smoother or lighter skin, a changed hairline or a "generic model" look all cost likeness points. A flattering photo that looks like a different person is a 'retake'.
3. Then judge professional polish (warped ears, extra fingers, melted collars, mismatched eyes, plastic skin, odd teeth) and lighting.

Be strict and use the full scale so the scores separate the shots clearly; don't give everything 8s. 'keeper' = ready for LinkedIn today, 'solid' = good with a small caveat, 'retake' = don't use.

Then choose best_frame: the one headshot you'd tell this person to use. It must be your highest-scoring frame (or tied for it). The headline and summary are shown right next to that photo, so they must describe it accurately — its backdrop, outfit and expression as they actually appear — and must not praise a different look as the best. Every headshot is labelled "Frame NN — backdrop · outfit"; use those frame numbers and names only. Be specific and encouraging; never comment on attractiveness or body.`;

export async function reviewShots({ references, shots }) {
  const content = [{ type: "text", text: `Reference selfies of the person (${references.length}):` }];
  references.forEach((r) => content.push(img(r)));
  content.push({ type: "text", text: `Generated headshots (${shots.length}):` });
  shots.forEach((s) => {
    content.push({ type: "text", text: `Frame ${String(s.frame).padStart(2, "0")} — ${s.label}:` });
    content.push(img(s));
  });
  content.push({ type: "text", text: `Grade every headshot (one entry per frame: ${shots.map((s) => s.frame).join(", ")}), then choose best_frame and write the headline and summary about it.` });
  const out = await askClaude({ system: REVIEW_SYSTEM, content, schema: ReviewSchema, effort: "high" });
  return out;
}
