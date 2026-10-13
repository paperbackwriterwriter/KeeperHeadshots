// DEV/QA ONLY — layouts that must hold up to larger text and long words:
// the header collapses into its menu whenever its links don't fit (text-only
// zoom enlarges text without reaching the CSS breakpoint), and a customer
// card wraps a long unbroken quote or name instead of stretching its photo.
// Needs the layout-ci server.   node scripts/dev/text-resize-tests.js <out dir>
import fs from "node:fs";
import { existsSync } from "node:fs";
import { chromium, webkit } from "playwright";
import { customersSection } from "../../public/js/shared/customers.js";
const B = process.env.BASE || "http://localhost:3100";
const OUT = process.argv[2] || "/tmp/text-resize";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const executablePath = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
const errs = [];

// 1. Text at 200%: no header control runs off the screen, and the menu works.
for (const scheme of ["light", "dark"]) for (const width of [1280, 1440]) {
  const page = await (await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme })).newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(B + "/", { waitUntil: "networkidle" });
  const before = await page.evaluate(() => document.getElementById("nav").classList.contains("nav-compact"));
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.waitForFunction(() => document.getElementById("nav").classList.contains("nav-compact"), null, { timeout: 3000 }).catch(() => {});
  const r = await page.evaluate(() => ({
    off: [...document.querySelectorAll("#nav .nav-inner a, #nav .nav-inner button")].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()).filter((b) => b.right > innerWidth + 1 || b.left < -1).length,
    toggle: !!document.getElementById("navToggle")?.offsetParent,
  }));
  ok(`${scheme} ${width}px, text at 200%: the header fits, collapsed into its menu`, !before && r.off === 0 && r.toggle, JSON.stringify(r));
  if (width === 1280 && scheme === "light") {
    await page.click("#navToggle");
    const open = await page.evaluate(() => document.getElementById("navSheet").classList.contains("open") && !!document.querySelector("#navSheet a")?.offsetParent);
    ok("and the menu opens", open);
    await page.screenshot({ path: `${OUT}/nav-200.png` });
    await page.click("#navToggle");
    await page.addStyleTag({ content: "html { font-size: 100% !important; }" });
    await page.waitForFunction(() => !document.getElementById("nav").classList.contains("nav-compact"), null, { timeout: 3000 }).catch(() => {});
    ok("back at normal text size, the links are back in the header", await page.evaluate(() => !document.getElementById("nav").classList.contains("nav-compact") && !!document.querySelector(".nav-links a")?.offsetParent));
  }
  await page.context().close();
}

// 2. A long unbroken quote, name and role on a customer card.
const long = "Absolutelyfantasticheadshotsthatlookexactlylikemewithoutanyphotoshoot".repeat(2);
const entries = [{ id: "shc_long", name: "Maximilianabcdefghijklmnopqrstuvwxyzlongname", role: "Seniorvicepresidentofeverythingandmore", quote: long, v: "1" }, { id: "shc_short", name: "Ana", role: "Designer", quote: "Great.", v: "1" }];
for (const width of [390, 1280]) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(B + "/refunds", { waitUntil: "networkidle" });
  await page.evaluate((h) => document.querySelector("main").insertAdjacentHTML("afterbegin", h), customersSection(entries));
  const cards = await page.evaluate(() => [...document.querySelectorAll(".customer")].map((c) => {
    const card = c.getBoundingClientRect(), img = c.querySelector("img").getBoundingClientRect();
    return { imgFits: img.width <= card.width + 0.5, ratio: +(img.height / img.width).toFixed(2), clipped: [...c.querySelectorAll("blockquote, b, span")].some((x) => x.getBoundingClientRect().right > card.right + 1) };
  }));
  ok(`${width}px: a long unbroken quote wraps, and the photo keeps its size and shape`, cards.every((c) => c.imgFits && c.ratio === 1.33 && !c.clipped), JSON.stringify(cards));
  await page.locator(".customers").screenshot({ path: `${OUT}/customers-${width}.png` });
  await page.context().close();
}
// 3. No page scrolls sideways at 200% text, at desktop, just above the
// tablet breakpoint and at phone width.
for (const width of [1280, 901, 390]) {
  const wide = [];
  for (const path of ["/", "/contact", "/team-headshots", "/refunds", "/privacy"]) {
    const page = await (await browser.newContext({ viewport: { width, height: 800 } })).newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(B + path, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await page.waitForTimeout(250);
    const extra = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (extra > 0) wide.push(`${path} +${extra}px`);
    await page.context().close();
  }
  ok(`${width}px, text at 200%: no page scrolls sideways`, !wide.length, wide.join(", "));
}
ok("no page errors", !errs.length, errs.join("; "));
await browser.close();
const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
