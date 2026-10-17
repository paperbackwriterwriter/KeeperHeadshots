// Social preview images (og:image) for the landing pages, 1200×630.
//
// The text half of each image is prerendered with the site's fonts by
// `npm run og` (scripts/build-og.js) into assets/og/<slug>.png. The two
// example headshots are added here from storage (lib/examples.js) when the
// image is first asked for, so the preview always shows the page's current
// examples. The CDN keeps the result, and so does this server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { exampleImage } from "./examples.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
export const OG_W = 1200, OG_H = 630;
// Where the two headshots go (3:4), staggered on the right.
export const SLOTS = [
  { left: 690, top: 80, width: 210, height: 280 },
  { left: 924, top: 266, width: 210, height: 280 },
];

export const OG_PAGES = {
  home: { path: "/", title: "Headshots worth keeping.", sub: "Studio-quality professional headshots from a few selfies. From $29, money-back guarantee.", examples: ["hero-1", "strip-3"] },
  linkedin: { path: "/linkedin-headshots", title: "LinkedIn headshots from a few selfies", sub: "A perfect square crop for LinkedIn and Teams. From $29, one-time.", examples: ["strip-1", "strip-2"] },
  team: { path: "/team-headshots", title: "Matching headshots for your whole team", sub: "One look for everyone, a few selfies each. No photographer to schedule.", examples: ["team-1", "team-3"] },
  "real-estate": { path: "/real-estate-headshots", title: "Real estate agent headshots", sub: "Ready for business cards, signs, listings and social media.", examples: ["re-1", "re-3"] },
  resume: { path: "/resume-headshots", title: "Résumé and CV headshots", sub: "A portrait for your CV and a square for LinkedIn and job sites.", examples: ["cv-2", "cv-1"] },
  doctor: { path: "/doctor-headshots", title: "Headshots for doctors and care teams", sub: "White coat, scrubs or business attire. From $29, one-time.", examples: ["md-1", "md-3"] },
  lawyer: { path: "/lawyer-headshots", title: "Headshots for lawyers and law firms", sub: "Ready for attorney bios, directories and LinkedIn.", examples: ["lw-1", "lw-2"] },
};
export const ogSlugFor = (pathname) => Object.keys(OG_PAGES).find((k) => OG_PAGES[k].path === pathname) || null;
const known = (slug) => Object.hasOwn(OG_PAGES, slug);

// Literal paths, so the deployment bundler includes the files.
const BASES = {
  home: path.join(dir, "..", "assets", "og", "home.png"),
  linkedin: path.join(dir, "..", "assets", "og", "linkedin.png"),
  team: path.join(dir, "..", "assets", "og", "team.png"),
  "real-estate": path.join(dir, "..", "assets", "og", "real-estate.png"),
  resume: path.join(dir, "..", "assets", "og", "resume.png"),
  doctor: path.join(dir, "..", "assets", "og", "doctor.png"),
  lawyer: path.join(dir, "..", "assets", "og", "lawyer.png"),
};

const made = new Map();
// { buf, complete }: complete is false when an example was missing (the
// frame is left empty), so the caller caches it only briefly.
export async function ogImage(slug) {
  if (!known(slug)) return null;
  if (made.has(slug)) return { buf: made.get(slug), complete: true };
  const base = fs.readFileSync(BASES[slug]);
  const layers = await Promise.all(
    SLOTS.map(async (s, i) => {
      const src = await exampleImage(OG_PAGES[slug].examples[i]).catch(() => null);
      // Without the example (a local copy with no examples yet) the frame stays empty.
      if (!src) return null;
      return { input: await sharp(src).resize(s.width, s.height, { fit: "cover", position: "attention" }).toBuffer(), left: s.left, top: s.top };
    }),
  );
  const out = await sharp(base).composite(layers.filter(Boolean)).png({ compressionLevel: 9, palette: false }).toBuffer();
  // Only keep a complete image, so a missing example is retried next time.
  const complete = layers.every(Boolean);
  if (complete) made.set(slug, out);
  return { buf: out, complete };
}
