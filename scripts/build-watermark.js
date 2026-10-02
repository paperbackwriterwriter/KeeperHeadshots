// Prerenders the free-preview watermark (lib/preview.js) with the site's own
// fonts, into assets/watermark/: a diagonal "PREVIEW" mark that is tiled
// across each headshot, and a band for the bottom edge. Vercel's servers
// have no fonts, so the text is drawn here, once. Re-run after changing it:
//   npm run watermark
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { TILE, BAND } from "../lib/preview.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(root, "public", "fonts", f)).toString("base64")}`;
const head = `<meta charset="utf-8"><style>
@font-face { font-family: Figtree; src: url(${font("figtree-latin.woff2")}) format("woff2"); font-weight: 300 900; }
* { margin: 0; box-sizing: border-box; }
html, body { background: transparent; font-family: Figtree, sans-serif; overflow: hidden; }
</style>`;

// White text with a dark outline and shadow, so it shows on light and dark
// backdrops alike. One mark per tile, centred, so tiles never cut a word.
const tile = `<!doctype html><html><head>${head}<style>
body { width: ${TILE.w}px; height: ${TILE.h}px; display: grid; place-items: center; }
.m { transform: rotate(-30deg); text-align: center; color: rgba(255,255,255,0.66);
  -webkit-text-stroke: 1.4px rgba(20,33,61,0.6); text-shadow: 0 2px 6px rgba(0,0,0,0.35); font-weight: 800; line-height: 1; white-space: nowrap; }
.m b { display: block; font-size: 58px; letter-spacing: 0.12em; }
.m small { display: block; font-size: 18px; letter-spacing: 0.3em; margin-top: 8px; font-weight: 700; }
</style></head><body><div class="m"><b>PREVIEW</b><small>KEEPER HEADSHOTS</small></div></body></html>`;

const band = `<!doctype html><html><head>${head}<style>
body { width: ${BAND.w}px; height: ${BAND.h}px; background: rgba(20,33,61,0.92); color: #f7f2e9; display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 22px; font-weight: 600; white-space: nowrap; }
b { color: #e0b766; letter-spacing: 0.16em; font-weight: 800; }
span { opacity: 0.9; }
</style></head><body><b>FREE PREVIEW</b><span>Buy any package to remove the watermark · keeperheadshots.com</span></body></html>`;

const exe = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].find((p) => p && fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const out = path.join(root, "assets", "watermark");
fs.mkdirSync(out, { recursive: true });
for (const [name, markup, size] of [["tile", tile, TILE], ["band", band, BAND]]) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  await page.setContent(markup);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
  await page.close();
  console.log(`wrote assets/watermark/${name}.png`);
}
await browser.close();
