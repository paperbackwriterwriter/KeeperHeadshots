// DEV/QA ONLY — clicks through the whole app in Chromium at phone and desktop
// widths and saves screenshots. Expects the server on BASE wired to mock-ai.js.
//   node scripts/dev/screenshots.js <outDir>

import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const BASE = process.env.BASE || "http://localhost:3100";
const OUT = process.argv[2] || "shots";
const ONLY = process.env.ONLY;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const errors = [];

async function page(width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce", ignoreHTTPSErrors: true });
  // Serve Google Fonts from a local cache when the sandbox can't reach them.
  if (process.env.FONT_CACHE) {
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
      const u = new URL(route.request().url());
      if (u.host === "fonts.googleapis.com") return route.fulfill({ contentType: "text/css", body: fs.readFileSync(path.join(process.env.FONT_CACHE, "fonts.css")) });
      return route.fulfill({ contentType: "font/woff2", body: fs.readFileSync(path.join(process.env.FONT_CACHE, u.pathname.slice(1).replace(/\//g, "_"))) });
    });
  }
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && errors.push(`[${width}] ${m.text()}`));
  p.on("pageerror", (e) => errors.push(`[${width}] ${e.message}`));
  return p;
}
const shot = async (p, name, full = true) => {
  if (full) {
    // Scroll through once so lazy images and reveal-on-scroll content load.
    await p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
      window.scrollTo(0, 0);
    });
  }
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log("saved", name);
};
const overflow = async (p, name) => {
  const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (o > 0) {
    const who = await p.evaluate(() => [...document.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest(".stepper, .strip")).slice(0, 6).map((e) => `${e.tagName}.${e.className}`));
    errors.push(`${name}: horizontal overflow ${o}px — ${who.join(", ")}`);
  }
};

async function selfieFiles() {
  const dir = path.join(OUT, "_selfies");
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, `selfie-${i}.jpg`);
    await sharp(Buffer.from(portraitSVG("qa" + i, { outfit: "white-shirt", backdrop: ["botanical", "city-terrace", "glass-office", "library"][i], skin: 2, hair: "short", hairTone: 2 }))).resize(900, 1125).jpeg().toBuffer().then((b) => fs.writeFileSync(f, b));
    files.push(f);
  }
  return files;
}

for (const [label, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  if (ONLY && ONLY !== label) continue;
  const p = await page(w, h);

  await p.goto(BASE + "/");
  await p.waitForLoadState("networkidle");
  await overflow(p, `${label} landing`);
  await shot(p, `${label}-01-landing-top`, false);
  await shot(p, `${label}-02-landing-full`);

  await p.goto(BASE + "/signin");
  await shot(p, `${label}-03-signin`, false);
  await p.click("#submit");
  await shot(p, `${label}-04-signin-errors`, false);

  // Demo account → dashboard → sample proofs
  await p.click("#demo");
  await p.waitForURL("**/app");
  await p.waitForSelector(".shoot-card img");
  await overflow(p, `${label} dashboard`);
  await shot(p, `${label}-05-dashboard`);
  await p.click(".shoot-card");
  await p.waitForSelector(".proof img");
  await overflow(p, `${label} proofs`);
  await shot(p, `${label}-06-sample-proofs`);
  await p.click(".proof button.open");
  await p.waitForSelector("dialog[open] .lb img");
  await shot(p, `${label}-07-lightbox`, false);
  await p.keyboard.press("Escape");
  await p.click("#signOut");
  await p.waitForURL(BASE + "/");

  // New account → real flow through the mocked AI
  await p.goto(BASE + "/signup");
  await p.fill("#name", "Jordan Lee");
  await p.fill("#email", `jordan+${label}${Date.now()}@example.com`);
  await p.fill("#password", "password123");
  await shot(p, `${label}-08-signup`, false);
  await p.click("#submit");
  await p.waitForURL("**/app/new");
  await shot(p, `${label}-09-upload-empty`);
  await p.setInputFiles("#file", await selfieFiles());
  await p.waitForSelector(".thumb:nth-child(4)");
  await shot(p, `${label}-10-upload-filled`);
  await p.click("#go");
  await p.waitForSelector(".scan");
  await p.waitForTimeout(600);
  await shot(p, `${label}-11-checking`, false);
  await p.waitForSelector(".verdict", { timeout: 30000 });
  await p.waitForTimeout(900);
  await overflow(p, `${label} check`);
  await shot(p, `${label}-12-check-result`);
  await p.click("#toLooks");
  await p.click('[data-backdrop="library"]');
  await p.click('[data-outfit="black-turtleneck"]');
  await p.click("#addLook");
  await overflow(p, `${label} looks`);
  await shot(p, `${label}-13-looks`);
  await p.click("#develop");
  await p.waitForSelector("#contact");
  await p.waitForTimeout(4500);
  await shot(p, `${label}-14-developing`);
  await p.waitForSelector(".proof-hero", { timeout: 90000 });
  await p.waitForTimeout(800);
  await overflow(p, `${label} results`);
  await shot(p, `${label}-15-proofs`);
  await p.context().close();
}

// 404 + empty dashboard
if (!ONLY || ONLY === "misc") {
  const p = await page(1440);
  await p.goto(BASE + "/nope");
  await shot(p, "misc-404", false);
  await p.goto(BASE + "/signup");
  await p.fill("#name", "Empty State");
  await p.fill("#email", `empty${Date.now()}@example.com`);
  await p.fill("#password", "password123");
  await p.click("#submit");
  await p.waitForURL("**/app/new");
  await p.goto(BASE + "/app");
  await p.waitForSelector(".empty");
  await shot(p, "misc-empty-dashboard", false);
}

await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "No console errors or overflow.");
