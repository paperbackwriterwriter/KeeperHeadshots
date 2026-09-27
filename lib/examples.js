// Example headshots for the marketing pages, rendered by the same image model
// and briefs as customer shoots. The people are fictional (generated from a
// description); "hero" and "rv" each start from a generated casual selfie that
// is then used as the reference photo, exactly like a customer's selfie.
//
// Images are stored as examples/<id>.jpg and served from /examples/<id>.jpg.
// Generate them with GET /api/admin/examples/<id>?token=ADMIN_TOKEN.

import sharp from "sharp";
import { generateHeadshot, sceneBrief, widenForCircle } from "./ai.js";
import { getFile, putFile } from "./storage.js";
import { lookFor, BACKDROPS, OUTFITS } from "../public/js/shared/catalog.js";
import { background } from "./pipeline.js";

const HERO = "a woman in her mid-30s of mixed Black and white heritage, with shoulder-length curly dark-brown hair, warm brown eyes and a friendly face";
const RV = "a South Asian woman in her early 40s with long straight black hair worn loose past the shoulders, dark brown eyes and small gold stud earrings";

const selfie = (desc, where = "indoors next to a window in soft natural daylight", wearing = "a plain crew-neck t-shirt") =>
  [
    `A casual, candid smartphone selfie of ${desc}.`,
    `Taken at arm's length ${where}, wearing ${wearing}, with a relaxed natural smile. Head and shoulders, slightly imperfect framing, an ordinary background slightly out of focus.`,
    "Shot with the front-facing camera, so the phone itself is not visible and there is no on-screen camera interface, icons or overlays. Realistic phone-camera quality: natural skin texture and pores, no makeup filter, no beauty retouching. A real, specific person with natural asymmetry — not a model. Photorealistic, one person only, no text or watermark.",
  ].join("\n\n");

const fromText = (desc, backdrop, outfit, take = 0, note = "") =>
  [
    `Create a photorealistic professional studio headshot of ${desc}. They should look like a real, specific person photographed at a real portrait session — natural skin texture, natural asymmetry, not an idealised or model-like face.`,
    ...sceneBrief({ look: lookFor(backdrop, outfit), take }),
    note,
  ]
    .filter(Boolean)
    .join("\n\n");

const fromRef = (backdrop, outfit, take, note = "") =>
  [
    "Create a professional headshot of the person in the reference photo above. It must be the same real person: keep their face exactly as it is in the photo — the same facial structure, features, skin, hair, hairline and apparent age. Change only the clothing, background, lighting, pose and camera. Keep the face's exact proportions, with no lens distortion.",
    ...sceneBrief({ look: lookFor(backdrop, outfit), take }),
    note,
  ]
    .filter(Boolean)
    .join("\n\n");

const HERO_FRAMES = [
  ["studio-gray", "navy-suit"], ["glass-office", "charcoal-blazer"], ["city-terrace", "camel-knit"],
  ["library", "black-turtleneck"], ["studio-gray", "charcoal-blazer"], ["botanical", "oxford"],
  ["studio-white", "white-shirt"], ["glass-office", "navy-suit"], ["city-terrace", "oxford"],
];

const RV_FRAMES = [
  ["studio-gray", "navy-suit"], ["glass-office", "charcoal-blazer"], ["city-terrace", "camel-knit"], ["library", "black-turtleneck"],
];

const STRIP = [
  ["a Black man in his early 50s with close-cropped greying hair and a short salt-and-pepper beard", "studio-gray", "navy-suit"],
  ["an East Asian woman in her early 30s with straight shoulder-length black hair", "glass-office", "charcoal-blazer"],
  ["a white woman in her late 20s with long wavy auburn hair and light freckles", "city-terrace", "camel-knit"],
  ["a South Asian man in his late 30s with short dark hair and a neatly trimmed beard", "library", "black-turtleneck"],
  ["a Latina woman in her mid-40s with dark hair pulled back in a low bun", "studio-white", "white-shirt"],
  ["a white man in his early 60s with short silver hair and rectangular glasses", "botanical", "oxford"],
  ["a Middle Eastern woman in her mid-20s with long dark curly hair", "studio-gray", "charcoal-blazer"],
];

// A matching team for /team-headshots: six people, one backdrop.
export const TEAM = [
  ["a white woman in her mid-30s with a shoulder-length brown bob", "charcoal-blazer"],
  ["a Black man in his early 40s with a shaved head and a short neat beard", "navy-suit"],
  ["a South Asian woman in her late 20s with long dark hair in a low ponytail", "white-shirt"],
  ["an East Asian man in his early 50s with short greying hair", "charcoal-blazer"],
  ["a Latina woman in her early 40s with curly shoulder-length dark hair", "navy-suit"],
  ["a white man in his early 30s with short red hair and a trimmed red beard", "oxford"],
];

// Real estate agents for /real-estate-headshots: warm, approachable looks.
export const REAL_ESTATE = [
  ["a white woman in her early 40s with shoulder-length highlighted blonde hair", "city-terrace", "navy-suit"],
  ["a Black man in his mid-30s with short twists and a neatly trimmed beard", "glass-office", "charcoal-blazer"],
  ["a Latina woman in her late 30s with long dark wavy hair", "botanical", "white-shirt"],
  ["an East Asian man in his late 40s with short black hair and a friendly face", "studio-white", "oxford"],
];
const AGENT_NOTE = "Expression (use this instead of the expression described above): a warm, genuine, approachable smile showing a little teeth, with friendly eyes that engage the camera: the kind of face a home buyer instantly trusts.";

// Job seekers for /resume-headshots: clean, neutral CV-photo looks.
export const RESUME = [
  ["a Black woman in her early 20s with natural curly hair pulled back from her face", "studio-white", "charcoal-blazer"],
  ["a white man in his mid-30s with short brown hair and light stubble", "studio-gray", "navy-suit"],
  ["a South Asian woman in her mid-40s with shoulder-length dark hair", "glass-office", "charcoal-blazer"],
  ["an East Asian man in his late 20s with short black hair and thin-framed glasses", "studio-white", "oxford"],
];

// More people for the rotating hero: each is a selfie plus nine headshots.
// Every set takes nine different backdrop/outfit pairs from all 36.
const PEOPLE = [
  ["a Black man in his late 20s with a short fade haircut and a clean-shaven face", "in a kitchen next to a window in soft daylight", "a grey hoodie"],
  ["an East Asian man in his mid-40s with short black hair and thin-framed glasses", "sitting in a parked car on an overcast day", "a plain navy t-shirt"],
  ["a white woman in her early 50s with a chin-length silver-blonde bob", "at a home office desk lit by a window", "a denim shirt"],
  ["a Latino man in his early 30s with short wavy dark hair and a short beard", "on an apartment balcony in open shade", "a white t-shirt"],
  ["a Black woman in her early 40s with shoulder-length box braids", "in a living room in warm evening lamp light", "a striped long-sleeve top"],
  ["a white man in his late 50s with short grey hair and a trimmed grey beard", "outdoors in a park on a cloudy day", "a green sweatshirt"],
  ["a Middle Eastern man in his mid-30s with short dark hair and light stubble", "in a bright hallway at home", "a black t-shirt"],
  ["a Southeast Asian woman in her late 20s with long straight dark hair", "at a café table by the window", "a casual flannel shirt"],
];
const PAIRS = Array.from({ length: 36 }, (_, i) => [BACKDROPS[i % 6].id, OUTFITS[(i + Math.floor(i / 6)) % 6].id]);
export const SETS = PEOPLE.map((_, k) => `p${k + 1}`);

export const JOBS = {
  ...Object.fromEntries(
    PEOPLE.flatMap(([desc, where, wearing], k) => [
      [`p${k + 1}-selfie`, { prompt: selfie(desc, where, wearing) }],
      ...Array.from({ length: 9 }, (_, j) => {
        const [b, o] = PAIRS[(k * 9 + j) % 36];
        return [`p${k + 1}-${j + 1}`, { ref: `p${k + 1}-selfie`, prompt: fromRef(b, o, j) }];
      }),
    ]),
  ),
  "hero-selfie": { prompt: selfie(HERO) },
  ...Object.fromEntries(HERO_FRAMES.map(([b, o], i) => [`hero-${i + 1}`, { ref: "hero-selfie", prompt: fromRef(b, o, i) }])),
  "rv-selfie": { prompt: selfie(RV) },
  ...Object.fromEntries(
    RV_FRAMES.map(([b, o], i) => [`rv-${i + 1}`, { ref: "rv-selfie", prompt: fromRef(b, o, i, i === 3 ? "This take has slightly harsh, uneven light and a less flattering head angle than the others." : "") }]),
  ),
  ...Object.fromEntries(STRIP.map(([d, b, o], i) => [`strip-${i + 1}`, { prompt: fromText(d, b, o, i) }])),
  ...Object.fromEntries(REAL_ESTATE.map(([d, b, o], i) => [`re-${i + 1}`, { prompt: fromText(d, b, o, i, AGENT_NOTE) }])),
  ...Object.fromEntries(RESUME.map(([d, b, o], i) => [`cv-${i + 1}`, { prompt: fromText(d, b, o, i) }])),
  ...Object.fromEntries(TEAM.map(([d, o], i) => [`team-${i + 1}`, { prompt: fromText(d, "glass-office", o, i) }])),
};

const key = (id) => `examples/${id}.jpg`;
// "<id>-sq" is the square profile-photo version of an example (see generateSquare).
export const exampleImage = (id) => (JOBS[id.replace(/-sq$/, "")] ? getFile(key(id)) : null);

export async function status() {
  const ids = Object.keys(JOBS);
  const have = await Promise.all(ids.map(async (id) => !!(await getFile(key(id)))));
  return Object.fromEntries(ids.map((id, i) => [id, have[i]]));
}

export async function generate(id) {
  const job = JOBS[id];
  if (!job) throw Object.assign(new Error("Unknown example."), { status: 404 });
  const references = [];
  if (job.ref) {
    const buf = await getFile(key(job.ref));
    if (!buf) throw Object.assign(new Error(`Generate ${job.ref} first.`), { status: 409 });
    const data = await sharp(buf).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
    references.push({ mime: "image/jpeg", data: data.toString("base64") });
  }
  const out = await generateHeadshot({ references, prompt: job.prompt });
  const jpg = await sharp(out.data).resize(900, 1200, { fit: "cover" }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  await putFile(key(id), jpg, "image/jpeg");
  return jpg.length;
}

// The square LinkedIn/Teams version of an example, widened for a circular
// crop the same way customers' tight headshots are (lib/pipeline.js).
export async function generateSquare(id) {
  if (!JOBS[id]) throw Object.assign(new Error("Unknown example."), { status: 404 });
  const buf = await getFile(key(id));
  if (!buf) throw Object.assign(new Error(`Generate ${id} first.`), { status: 409 });
  const data = await sharp(buf).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer();
  const out = await widenForCircle({ mime: "image/jpeg", data: data.toString("base64") });
  const { width: w, height: h } = await sharp(out.data).metadata();
  const side = Math.min(w, h);
  const jpg = await sharp(out.data)
    .extract({ left: Math.floor((w - side) / 2), top: Math.floor((h - side) / 2), width: side, height: side })
    .resize(Math.min(side, 900))
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  await putFile(key(`${id}-sq`), jpg, "image/jpeg");
  return jpg.length;
}

// A small labelled grid of existing examples, for reviewing them in bulk.
export async function sheet(ids, width = 240, cols = 4, labels = true) {
  // Square "-sq" versions are letterboxed into the same 3:4 tile so the whole
  // square stays visible.
  const h = Math.round((width * 4) / 3);
  const tiles = [];
  for (const id of ids) {
    const buf = JOBS[id.replace(/-sq$/, "")] && (await getFile(key(id)));
    if (!buf) continue;
    const img = await sharp(buf).resize(width, h, { fit: id.endsWith("-sq") ? "contain" : "cover", background: "#ffffff" }).toBuffer();
    const label = Buffer.from(`<svg width="${width}" height="22"><rect width="100%" height="100%" fill="#14213d"/><text x="6" y="16" font-family="sans-serif" font-size="13" fill="#fff">${id}</text></svg>`);
    tiles.push(labels ? await sharp(img).composite([{ input: label, top: h - 22, left: 0 }]).toBuffer() : img);
  }
  if (!tiles.length) return null;
  const rows = Math.ceil(tiles.length / cols);
  return sharp({ create: { width: cols * width, height: rows * h, channels: 3, background: "#ffffff" } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * width, top: Math.floor(i / cols) * h })))
    .jpeg({ quality: labels ? 72 : 90 })
    .toBuffer();
}

// Build a whole person set in the background: the selfie first (unless it
// exists), then the nine headshots, a few at a time. Progress is visible via
// status(); each image is retried once.
const running = new Set();
export function generateSet(set, { force = false } = {}) {
  if (!SETS.includes(set)) throw Object.assign(new Error("Unknown set."), { status: 404 });
  if (running.has(set)) return false;
  running.add(set);
  const once = async (id) => {
    if (!force && (await getFile(key(id)))) return;
    try {
      await generate(id);
    } catch (err) {
      console.warn("[examples] retry", id, err.message);
      await new Promise((r) => setTimeout(r, 3000));
      await generate(id).catch((e) => console.error("[examples] failed", id, e.message));
    }
  };
  background(
    (async () => {
      await once(`${set}-selfie`);
      const frames = Array.from({ length: 9 }, (_, j) => `${set}-${j + 1}`);
      for (let i = 0; i < frames.length; i += 3) await Promise.all(frames.slice(i, i + 3).map(once));
    })().finally(() => running.delete(set)),
  );
  return true;
}
