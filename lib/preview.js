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

export const TILE = { w: 470, h: 330 }; // the repeating diagonal mark, at a 1024 px wide image
export const BAND = { w: 1024, h: 64 }; // the bottom band
export const PREVIEW_MAX = 1024; // longest side of a preview, in pixels

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "watermark");
let assets = null;
const load = () => (assets ||= { tile: fs.readFileSync(path.join(dir, "tile.png")), band: fs.readFileSync(path.join(dir, "band.png")) });

// Whether `meta`'s headshots are served as previews to their owner `user`.
// A refunded purchase (lib/billing.js reconcileRefund) doesn't count.
const purchases = (user) => (user?.purchases || []).filter((p) => !p.refunded);
export const hasBought = (user) => purchases(user).length > 0;
// Anything but a single kept headshot unlocks the whole preview.
export const unlocksPreviews = (user) => purchases(user).some((p) => p.packageId !== "keep");
export const isPreview = (meta, user) => !!meta?.preview && !unlocksPreviews(user) && (!user || planFor(user).tier !== "owner");
// Whether one headshot of a preview was bought on its own.
export const isKept = (user, sid, shotId) => !!shotId && (user?.kept?.[sid] || []).includes(shotId);

// Returns the image with the watermark: shrunk to PREVIEW_MAX, the diagonal
// mark tiled across it, and the band along the bottom (`band: false` for small
// round images like the email-signature size). Keeps PNG as PNG (with its
// transparency); everything else becomes JPEG.
export async function watermark(buf, { png = false, band = true } = {}) {
  const { tile, band: bandPng } = load();
  const img = sharp(buf).rotate().resize({ width: PREVIEW_MAX, height: PREVIEW_MAX, fit: "inside", withoutEnlargement: true });
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  // The mark scales with the image, and never past its edges (a wide banner
  // is shorter than one tile).
  const scale = Math.min(Math.max(0.3, W / 1024), W / TILE.w, H / TILE.h);
  const t = await sharp(tile).resize(Math.max(1, Math.round(TILE.w * scale)), Math.max(1, Math.round(TILE.h * scale))).toBuffer();
  const layers = [{ input: t, tile: true, top: 0, left: 0 }];
  if (band && H > 200) {
    const b = await sharp(bandPng).resize(W, Math.min(Math.round(H / 4), Math.max(24, Math.round(BAND.h * (W / BAND.w))))).toBuffer();
    layers.push({ input: b, gravity: "south" });
  }
  const out = sharp(data).composite(layers);
  return png ? out.png({ compressionLevel: 9 }).toBuffer() : out.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}
