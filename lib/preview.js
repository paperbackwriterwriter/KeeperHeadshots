// Free preview: a free shoot's headshots are shown and downloaded with a
// prominent watermark, at a reduced size, until the account buys a package or
// "Keep them all + 2 more looks". "Keep your pick" ($8.99) unlocks just the
// one headshot chosen at checkout (u.kept[shootId] = [shotId, ...]).
// Buying unlocks every earlier free shoot too (nothing is re-rendered: the
// originals are stored untouched, and the watermark is added as they're
// served, by the /media route in server.js).
//
// Only shoots developed after this change carry `preview: true` (set when the
// free shoot is charged), so headshots people already have stay as they were.
//
// The watermark images are prerendered with the site's fonts by
// scripts/build-watermark.js (assets/watermark/), since the servers have none.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { planFor } from "./plan.js";

export const OVERLAY = { w: 1200, h: 1200 }; // the diagonal "PREVIEW" rows, drawn for a 1024 px image
export const BAND = { w: 1024, h: 64 }; // the bottom band
export const PREVIEW_MAX = 1024; // longest side of a preview, in pixels

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "watermark");
let assets = null;
const load = () => (assets ||= { overlay: fs.readFileSync(path.join(dir, "overlay.png")), band: fs.readFileSync(path.join(dir, "band.png")) });

// Whether `meta`'s headshots are served as previews to their owner `user`.
// A refunded purchase (lib/billing.js reconcileRefund) doesn't count.
const purchases = (user) => (user?.purchases || []).filter((p) => !p.refunded);
export const hasBought = (user) => purchases(user).length > 0;
// Anything but a single kept headshot unlocks the whole preview.
export const unlocksPreviews = (user) => purchases(user).some((p) => p.packageId !== "keep");
export const isPreview = (meta, user) => !!meta?.preview && !unlocksPreviews(user) && (!user || planFor(user).tier !== "owner");
// Whether one headshot of a preview was bought on its own.
export const isKept = (user, sid, shotId) => !!shotId && (user?.kept?.[sid] || []).includes(shotId);

// Returns the image with the watermark: shrunk to PREVIEW_MAX, rows of
// "PREVIEW" running diagonally across all of it, and the band along the
// bottom (`band: false` for small round images like the email-signature
// size). Keeps PNG as PNG (with its transparency); everything else becomes JPEG.
export async function watermark(buf, { png = false, band = true } = {}) {
  const { overlay, band: bandPng } = load();
  const img = sharp(buf).rotate().resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside", withoutEnlargement: true });
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  // The words scale with the image's longest side (the overlay is drawn for
  // 1024 px, and is larger than the image at any scale), then it's cropped to fit.
  const scale = Math.max(0.25, Math.max(W, H) / PREVIEW_MAX);
  const size = Math.round(OVERLAY.w * scale);
  const o = await sharp(overlay).resize(size, size).extract({ left: Math.floor((size - W) / 2), top: Math.floor((size - H) / 2), width: W, height: H }).toBuffer();
  // "atop": only over the image itself, never filling a round PNG's transparent corners.
  const layers = [{ input: o, top: 0, left: 0, blend: "atop" }];
  if (band && H > 200) {
    const b = await sharp(bandPng).resize(W, Math.min(Math.round(H / 4), Math.max(24, Math.round(BAND.h * (W / BAND.w))))).toBuffer();
    layers.push({ input: b, gravity: "south" });
  }
  const out = sharp(data).composite(layers);
  return png ? out.png({ compressionLevel: 9 }).toBuffer() : out.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}
