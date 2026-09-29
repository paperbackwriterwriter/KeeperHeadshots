// Prerenders the text half of each landing page's social preview image
// (lib/og.js) with the site's own fonts, into assets/og/<slug>.png. The
// server adds the example headshots. Re-run after changing OG_PAGES:
//   npm run og
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { OG_PAGES, SLOTS, OG_W, OG_H } from "../lib/og.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Inlined: a page set with setContent can't load local files.
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(root, "public", "fonts", f)).toString("base64")}`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const corners = (s, pad = 12, len = 30) => {
  const [l, t, r, b] = [s.left - pad, s.top - pad, s.left + s.width + pad, s.top + s.height + pad];
  return `<path d="M${l} ${t + len}V${t}H${l + len}M${r - len} ${t}H${r}V${t + len}M${r} ${b - len}V${b}H${r - len}M${l + len} ${b}H${l}V${b - len}" />`;
};
const page = ({ title, sub }) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; src: url(${font("fraunces-latin.woff2")}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: Fraunces; src: url(${font("fraunces-latin-ext.woff2")}) format("woff2"); font-weight: 100 900; unicode-range: U+0100-024F; }
@font-face { font-family: Figtree; src: url(${font("figtree-latin.woff2")}) format("woff2"); font-weight: 300 900; }
* { margin: 0; box-sizing: border-box; }
body { width: ${OG_W}px; height: ${OG_H}px; background: #14213d; color: #f7f2e9; font-family: Figtree, sans-serif; position: relative; overflow: hidden; }
.brand { position: absolute; left: 72px; top: 64px; display: flex; align-items: center; gap: 16px; }
.brand svg { width: 56px; height: 56px; color: #f7f2e9; }
.brand b { font-family: Fraunces, serif; font-weight: 600; font-size: 34px; letter-spacing: -0.01em; display: block; line-height: 1; }
.brand small { display: block; font-size: 13px; font-weight: 700; letter-spacing: 0.32em; color: #c9a45c; margin-top: 6px; }
.copy { position: absolute; left: 72px; width: 570px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; padding-top: 40px; }
h1 { font-family: Fraunces, serif; font-weight: 600; font-size: 58px; line-height: 1.04; letter-spacing: -0.02em; text-wrap: balance; }
p { margin-top: 22px; font-size: 25px; line-height: 1.4; color: #cfd3dd; text-wrap: balance; }
.foot { position: absolute; left: 72px; bottom: 56px; font-size: 20px; font-weight: 600; color: #c9a45c; letter-spacing: 0.02em; }
.slot { position: absolute; background: #24365a; }
svg.frames { position: absolute; inset: 0; }
</style></head><body>
<div class="brand"><svg viewBox="0 0 100 100"><path d="M8 30V8h22M70 8h22v22M92 70v22H70M30 92H8V70" fill="none" stroke="#b8893b" stroke-width="7"/><text x="50" y="71" text-anchor="middle" font-family="Fraunces" font-size="62" font-weight="600" fill="currentColor">K</text></svg><span><b>Keeper</b><small>HEADSHOTS</small></span></div>
<div class="copy"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
<div class="foot">keeperheadshots.com</div>
${SLOTS.map((s) => `<div class="slot" style="left:${s.left}px;top:${s.top}px;width:${s.width}px;height:${s.height}px"></div>`).join("")}
<svg class="frames" viewBox="0 0 ${OG_W} ${OG_H}" fill="none" stroke="#b8893b" stroke-width="5">${SLOTS.map((s) => corners(s)).join("")}</svg>
</body></html>`;

// The cloud sandbox has its own Chromium; elsewhere Playwright's own is used.
const localChromium = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(fs.existsSync(localChromium) ? { executablePath: localChromium } : {});
const p = await browser.newPage({ viewport: { width: OG_W, height: OG_H } });
fs.mkdirSync(path.join(root, "assets", "og"), { recursive: true });
for (const [slug, def] of Object.entries(OG_PAGES)) {
  await p.setContent(page(def), { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const out = path.join(root, "assets", "og", `${slug}.png`);
  await p.screenshot({ path: out, type: "png" });
  console.log("wrote", path.relative(root, out));
}
await browser.close();
