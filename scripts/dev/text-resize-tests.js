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
// 4. Buttons stay whole at 200% text: none runs past the screen or is cut off
// by a panel that hides its overflow (the landing pages' closing panels, the
// signed-in header on a phone, a finished shoot's download buttons).
const cutOff = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("a.btn, button")) {
    const r = el.getBoundingClientRect();
    if (!r.width || el.closest("[hidden], dialog:not([open]), .nav-sheet:not(.open), .skip-link") || getComputedStyle(el).visibility === "hidden") continue;
    let why = r.right > document.documentElement.clientWidth + 1 || r.left < -1 ? "off screen" : null;
    for (let a = el.parentElement; a && !why && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(hidden|clip)/.test(cs.overflowX)) { const ar = a.getBoundingClientRect(); if (r.right > ar.right + 1 || r.left < ar.left - 1) why = `cut off by .${[...a.classList].join(".")}`; }
    }
    if (why) out.push(`${(el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 28)} (${why})`);
  }
  return out;
});
async function at200(ctx, path) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(B + path, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html { font-size: 200% !important; } [data-reveal] { opacity: 1 !important; transform: none !important; }" });
  await page.waitForTimeout(300);
  const out = await cutOff(page);
  await page.close();
  return out;
}
for (const width of [1440, 901]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const bad = [];
  for (const path of ["/", "/linkedin-headshots", "/team-headshots", "/resume-headshots", "/lawyer-headshots"]) bad.push(...(await at200(ctx, path)).map((x) => `${path}: ${x}`));
  ok(`${width}px, text at 200%: landing-page buttons are whole`, !bad.length, bad.join(" | "));
  await ctx.close();
}
{
  // A signed-in account with a finished free preview.
  const sharp = (await import("sharp")).default;
  const { portraitSVG } = await import("../../public/js/shared/portrait.js");
  const M = process.env.MOCK || "http://localhost:4010";
  let cookie = "";
  const f = async (p, o = {}) => { const r = await fetch(B + p, { ...o, headers: { "content-type": "application/json", cookie } }); const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0]; return r.json().catch(() => null); };
  const email = `textsize${Date.now()}@x.com`;
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Tess Size", email, password: "password123" }) });
  const mails = await fetch(`${M}/mock-mail`).then((r) => r.json());
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: new URL(mails.filter((m) => m.to.includes(email)).flatMap((m) => m.links).findLast((l) => l.includes("/verify?token="))).searchParams.get("token") }) });
  const sid = (await f("/api/shoots", { method: "POST", body: "{}" })).shoot.id;
  for (let i = 0; i < 6; i++) await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo: "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("ts" + i, {}))).resize(900, 1125).jpeg().toBuffer()).toString("base64") }) });
  await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
  await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }] }) });
  for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 1000)); if (!["generating", "reviewing"].includes((await f(`/api/shoots/${sid}`)).shoot.status)) break; }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: B }]);
  const header = await at200(ctx, "/app");
  ok("390px, text at 200%: the signed-in header fits (sign-out moves into the menu)", !header.length, header.join(" | "));
  const page = await ctx.newPage();
  await page.goto(B + "/app", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.waitForTimeout(300);
  await page.click("#navToggle");
  const inMenu = await page.locator(".nav-sheet-signout").waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
  ok("and Sign out is in the menu", inMenu && !(await page.locator("#signOut").isVisible()));
  await page.close();
  const results = await at200(ctx, `/app/shoot/${sid}`);
  ok("390px, text at 200%: a finished shoot's buttons are whole", !results.length, results.join(" | "));
  await ctx.close();
  // The preview's buy buttons and the package panel below them.
  for (const width of [390, 901, 1280]) {
    const c = await browser.newContext({ viewport: { width, height: 900 } });
    await c.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: B }]);
    const p = await c.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`${B}/app/shoot/${sid}`, { waitUntil: "networkidle" });
    await p.waitForSelector(".keep-cta");
    await p.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const panel = document.querySelector(".upsell"), cta = document.querySelector(".keep-cta");
      const spill = [...document.querySelectorAll(".keep-cta .btn, .upsell, .upsell *")].filter((el) => { const b = el.getBoundingClientRect(), pb = el.parentElement.getBoundingClientRect(); return b.width && b.right > pb.right + 1; }).map((el) => el.className || el.tagName);
      return { panel: !!panel, cta: !!cta, wide: document.documentElement.scrollWidth - innerWidth, spill: spill.slice(0, 4) };
    });
    ok(`${width}px, text at 200%: a preview's buy buttons and packages fit`, r.panel && r.cta && r.wide <= 0 && !r.spill.length, JSON.stringify(r));
    await c.close();
  }
}
ok("no page errors", !errs.length, errs.join("; "));
await browser.close();
const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
