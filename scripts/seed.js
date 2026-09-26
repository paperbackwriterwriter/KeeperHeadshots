// Seeds a demo account with two finished sample shoots so every screen has
// something real to show. Sample images are illustrations (clearly labelled
// "Sample" in the UI); your own shoots use real AI output.

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { users, shoots, id, saveMedia } from "../lib/store.js";
import { hashPassword } from "../lib/auth.js";
import { portraitSVG } from "../public/js/shared/portrait.js";
import { lookFor } from "../public/js/shared/catalog.js";

export const DEMO = { email: "demo@headshotpro.app", password: "studio-demo" };

async function render(seedKey, opts) {
  const jpg = await sharp(Buffer.from(portraitSVG(seedKey, opts))).resize(768, 1024, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
  return saveMedia(jpg, "jpg");
}

const daysAgo = (d, h = 0) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString();

async function sampleShoot(userId, spec) {
  const selfies = [];
  for (let i = 0; i < spec.selfies; i++) {
    selfies.push({ file: await render(`${spec.key}-selfie-${i}`, { skin: spec.skin, hair: spec.hair, hairTone: 0, backdrop: ["botanical", "city-terrace", "glass-office", "library"][i % 4], outfit: "white-shirt" }), width: 768, height: 1024 });
  }
  const shots = [];
  for (const l of spec.looks) {
    const look = lookFor(l.backdrop, l.outfit);
    for (let take = 0; take < 2; take++) {
      shots.push({
        id: id("shot"),
        lookId: look.id,
        backdrop: l.backdrop,
        outfit: l.outfit,
        take,
        status: "done",
        file: await render(`${spec.key}-${look.id}-${take}`, { skin: spec.skin, hair: spec.hair, hairTone: 0, backdrop: l.backdrop, outfit: l.outfit }),
        error: null,
      });
    }
  }
  const grades = spec.grades;
  const reviewShots = Object.fromEntries(shots.map((s, i) => [s.id, { index: i, ...grades[i % grades.length] }]));
  return shoots.create({
    id: id("sht"),
    userId,
    sample: true,
    name: spec.name,
    status: "done",
    createdAt: spec.createdAt,
    updatedAt: spec.createdAt,
    selfies,
    check: spec.check,
    looks: spec.looks,
    shots,
    review: { headline: spec.review.headline, summary: spec.review.summary, bestShotId: shots[spec.review.best].id, shots: reviewShots, at: spec.createdAt },
    error: null,
  });
}

export async function seed() {
  if (users.byEmail(DEMO.email)) return;
  const user = users.create({
    id: id("usr"),
    name: "Maya Okafor",
    email: DEMO.email,
    password: hashPassword(DEMO.password),
    createdAt: daysAgo(21),
    demo: true,
  });

  await sampleShoot(user.id, {
    key: "maya-a",
    name: "LinkedIn refresh",
    skin: 4,
    hair: "curly",
    selfies: 4,
    createdAt: daysAgo(2, 3),
    looks: [
      { backdrop: "studio-gray", outfit: "navy-suit" },
      { backdrop: "glass-office", outfit: "charcoal-blazer" },
      { backdrop: "city-terrace", outfit: "camel-knit" },
      { backdrop: "library", outfit: "black-turtleneck" },
    ],
    check: {
      overall_score: 88,
      verdict: "ready",
      headline: "A strong, varied set — ready for the studio.",
      summary: "Your photos are sharp, evenly lit and show your face clearly from a few different angles, which is exactly what the model needs to hold your likeness. The window-lit shot is your strongest reference.",
      subject: { description: "Dark brown, tightly curled shoulder-length hair; no glasses; no facial hair.", glasses: false },
      photos: [
        { index: 0, score: 92, keep: true, lighting: 9, sharpness: 9, face_visibility: 10, expression: 8, issues: [], note: "Soft window light and a relaxed smile — your best reference." },
        { index: 1, score: 84, keep: true, lighting: 7, sharpness: 9, face_visibility: 9, expression: 8, issues: ["Warm color cast"], note: "Golden-hour warmth is a little strong but features are crisp." },
        { index: 2, score: 90, keep: true, lighting: 9, sharpness: 9, face_visibility: 9, expression: 9, issues: [], note: "Great three-quarter angle that adds depth to the set." },
        { index: 3, score: 71, keep: true, lighting: 6, sharpness: 7, face_visibility: 8, expression: 7, issues: ["Low light"], note: "A bit dim, but still useful for hair texture." },
      ],
      tips: ["Add one photo taken outdoors in shade for an even more natural skin tone."],
      at: daysAgo(2, 3),
    },
    grades: [
      { likeness: 9, polish: 9, lighting: 9, overall: 94, grade: "keeper", best_for: "LinkedIn", note: "Crisp key light and a natural smile — this is the one." },
      { likeness: 8, polish: 8, lighting: 9, overall: 86, grade: "keeper", best_for: "Company site", note: "Confident, clean framing; slightly more formal expression." },
      { likeness: 8, polish: 9, lighting: 8, overall: 84, grade: "keeper", best_for: "Speaker bio", note: "Office bokeh reads modern and approachable." },
      { likeness: 7, polish: 7, lighting: 8, overall: 72, grade: "solid", best_for: "Slack avatar", note: "Collar is slightly soft on the left edge." },
      { likeness: 9, polish: 8, lighting: 8, overall: 88, grade: "keeper", best_for: "Personal site", note: "Golden-hour warmth flatters without over-smoothing." },
      { likeness: 8, polish: 8, lighting: 7, overall: 79, grade: "solid", best_for: "Newsletter", note: "Lovely mood; backlight is a touch strong." },
      { likeness: 6, polish: 6, lighting: 7, overall: 58, grade: "retake", best_for: "—", note: "Hairline drifts from your references — skip this one." },
      { likeness: 8, polish: 9, lighting: 8, overall: 83, grade: "keeper", best_for: "Author photo", note: "Rich library tones give it an editorial feel." },
    ],
    review: {
      best: 0,
      headline: "Seven keepers — your studio gray look leads.",
      summary: "Likeness held up across nearly every look, with the studio gray and golden-hour takes the strongest. Use the navy-suit portrait for LinkedIn and the library shot where you want a warmer, editorial feel.",
    },
  });

  await sampleShoot(user.id, {
    key: "maya-b",
    name: "Conference speaker kit",
    skin: 4,
    hair: "curly",
    selfies: 3,
    createdAt: daysAgo(9, 5),
    looks: [
      { backdrop: "studio-white", outfit: "white-shirt" },
      { backdrop: "botanical", outfit: "oxford" },
    ],
    check: {
      overall_score: 74,
      verdict: "usable",
      headline: "Usable — one more well-lit photo would help.",
      summary: "Two of your photos are clear and well lit; the third is a little soft. We'll lean on the sharp ones to keep your likeness consistent.",
      subject: { description: "Dark brown, tightly curled shoulder-length hair; no glasses.", glasses: false },
      photos: [
        { index: 0, score: 86, keep: true, lighting: 9, sharpness: 8, face_visibility: 9, expression: 8, issues: [], note: "Even daylight and a clear, front-on view." },
        { index: 1, score: 79, keep: true, lighting: 8, sharpness: 8, face_visibility: 8, expression: 7, issues: [], note: "Good texture detail in the hair." },
        { index: 2, score: 52, keep: false, lighting: 6, sharpness: 4, face_visibility: 7, expression: 7, issues: ["Motion blur"], note: "Too soft to trust for fine facial detail." },
      ],
      tips: ["Replace the blurry photo with a steady one at arm's length.", "Face a window so light falls evenly on both sides of your face."],
      at: daysAgo(9, 5),
    },
    grades: [
      { likeness: 8, polish: 9, lighting: 9, overall: 87, grade: "keeper", best_for: "Conference badge", note: "Bright, high-key and friendly — prints well at small sizes." },
      { likeness: 7, polish: 8, lighting: 9, overall: 78, grade: "solid", best_for: "Event program", note: "Clean, though the smile reads slightly posed." },
      { likeness: 9, polish: 8, lighting: 8, overall: 90, grade: "keeper", best_for: "Speaker bio", note: "Natural greenery makes this feel warm and candid." },
      { likeness: 8, polish: 7, lighting: 8, overall: 76, grade: "solid", best_for: "Social posts", note: "Sweater collar has a small texture artifact." },
    ],
    review: {
      best: 2,
      headline: "Botanical take wins — warm and candid.",
      summary: "The natural-light botanical look captures you best; the high-key white set is perfect for badges and printed programs.",
    },
  });
  console.log(`Seeded demo account: ${DEMO.email} / ${DEMO.password}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await seed();
