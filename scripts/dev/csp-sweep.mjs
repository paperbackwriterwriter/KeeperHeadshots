// Loads every public page in Chromium and reports console errors, CSP
// violations, failed requests and horizontal overflow at phone width.
import fs from "node:fs";
import { chromium } from "playwright";
import { PAGES } from "../../lib/seo.js";
const BASE = process.env.BASE || "http://localhost:3100";
const exe = ["/opt/pw-browsers/chromium"].find((p) => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const paths = [...Object.keys(PAGES), "/nope-404"];
for (const vw of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vw });
  for (const p of paths) {
    const page = await ctx.newPage();
    const issues = [];
    page.on("console", (m) => m.type() === "error" && issues.push("console: " + m.text().slice(0, 160)));
    page.on("pageerror", (e) => issues.push("pageerror: " + e.message.slice(0, 160)));
    page.on("requestfailed", (r) => { if (r.url().startsWith(BASE)) issues.push("failed: " + r.url()); });
    page.on("response", (r) => { if (r.url().startsWith(BASE) && r.status() >= 400 && !r.url().includes("nope-404") && !r.url().includes("/api/me")) issues.push(r.status() + " " + r.url()); });
    await page.goto(BASE + p, { waitUntil: "networkidle" }).catch((e) => issues.push("goto: " + e.message));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) issues.push("horizontal overflow " + over + "px");
    const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== "lazy").map((i) => i.src));
    if (broken.length) issues.push("broken images: " + broken.join(", "));
    const real = issues.filter((s) => !/challenges\.cloudflare|facebook|fonts\.g|ERR_CERT_AUTHORITY_INVALID/.test(s) || /Content Security Policy/.test(s));
    if (real.length) { bad++; console.log(`FAIL ${vw.width} ${p}\n  ` + real.join("\n  ")); } else console.log(`ok   ${vw.width} ${p}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} page(s) with issues` : "all clean");
