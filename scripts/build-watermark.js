// Prerenders the free-preview watermark (lib/preview.js) with the site's own
// fonts, into assets/watermark/: rows of "PREVIEW" running diagonally across
// the whole headshot (one overlay, cropped to each image), and a band for the
// bottom edge. Vercel's servers
// have no fonts, so the text is drawn here, once. Re-run after changing it:
//   npm run watermark
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { OVERLAY, BAND } from "../lib/preview.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(root, "public", "fonts", f)).toString("base64")}`;
const head = `<meta charset="utf-8"><style>
@font-face { font-family: Figtree; src: url(${font("figtree-latin.woff2")}) format("woff2"); font-weight: 300 900; }
* { margin: 0; box-sizing: border-box; }
html, body { background: transparent; font-family: Figtree, sans-serif; overflow: hidden; }
</style>`;

// Semi-transparent white words with a soft shadow, so they show on light and
// dark backdrops alike: staggered rows, tilted 30 degrees, covering the whole
// overlay (the rotated block is larger than it, so no corner is left bare).
const words = Array.from({ length: 9 }, () => "<i>PREVIEW</i>").join("");
const rows = Array.from({ length: 22 }, (_, r) => `<div class="row${r % 2 ? " off" : ""}">${words}</div>`).join("");
const overlay = `<!doctype html><html><head>${head}<style>
body { width: ${OVERLAY.w}px; height: ${OVERLAY.h}px; position: relative; }
.wall { position: absolute; left: 50%; top: 50%; width: 2000px; transform: translate(-50%, -50%) rotate(-30deg); display: grid; gap: 58px; }
.row { display: flex; gap: 64px; white-space: nowrap; justify-content: center; }
.row.off { transform: translateX(105px); }
i { font-style: normal; font-size: 34px; font-weight: 700; letter-spacing: 0.1em; color: rgba(255,255,255,0.62);
  text-shadow: 0 1px 2px rgba(0,0,0,0.35), 0 0 1px rgba(20,33,61,0.5); }
</style></head><body><div class="wall">${rows}</div></body></html>`;

const band = `<!doctype html><html><head>${head}<style>
body { width: ${BAND.w}px; height: ${BAND.h}px; background: rgba(20,33,61,0.92); color: #f7f2e9; display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 22px; font-weight: 600; white-space: nowrap; }
b { color: #e0b766; letter-spacing: 0.16em; font-weight: 800; }
span { opacity: 0.9; }
</style></head><body><b>FREE PREVIEW</b><span>Keep these headshots from $8.99 · keeperheadshots.com</span></body></html>`;

const exe = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const out = path.join(root, "assets", "watermark");
fs.mkdirSync(out, { recursive: true });
for (const [name, markup, size] of [["overlay", overlay, OVERLAY], ["band", band, BAND]]) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  await page.setContent(markup);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
  await page.close();
  console.log(`wrote assets/watermark/${name}.png`);
}
await browser.close();
