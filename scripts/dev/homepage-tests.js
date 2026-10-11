// DEV/QA ONLY — homepage startup and navigation on a throwaway local store.
// Marketing images and the Meta SDK are fixtures; no external services run.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const OUT = process.argv[2] || "homepage-shots";
await fs.mkdir(OUT, { recursive: true });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-homepage-"));
for (const key of Object.keys(process.env)) {
  if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, { DATA_DIR: dir, SESSION_SECRET: crypto.randomBytes(32).toString("hex"), VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "test", META_PIXEL_ID: "123456" });
const { default: app } = await import("../../server.js");
delete process.env.VERCEL;
const { seed, DEMO } = await import("../seed.js");
await seed();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
const images = new Map();
const localChromium = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
let browser;
let passed = 0;
const pass = (name) => { passed++; console.log(`PASS ${name}`); };

async function contextFor({ width = 390, signedIn = false, scale = 1, stalledFrames = false, failedSession = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: scale, reducedMotion: "reduce" });
  await context.addInitScript((stalled) => {
    document.addEventListener("DOMContentLoaded", () => {
      window.__initialHeadline = document.querySelector(".hero h1");
      const customers = document.getElementById("customers");
      if (customers) {
        customers.textContent = "A previously shared result";
        customers.hidden = false;
        window.__initialCustomers = customers;
      }
    });
    window.__metaCalls = [];
    if (stalled) window.requestAnimationFrame = () => 0;
  }, stalledFrames);
  await context.route("**/api/me", async (route) => {
    if (failedSession) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Local session unavailable" }) });
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ response });
  });
  await context.route("**/examples/**", async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname + url.search;
    if (!images.has(key)) images.set(key, sharp(Buffer.from(portraitSVG(url.pathname, { outfit: "navy-suit" }))).resize(Number(url.searchParams.get("w") || 600)).webp().toBuffer());
    await route.fulfill({ contentType: "image/webp", body: await images.get(key) });
  });
  await context.route(/https:\/\//, async (route) => {
    if (route.request().url().endsWith("/fbevents.js")) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ contentType: "application/javascript", body: `
        window.__sdkKeptHeadline = document.querySelector('.hero h1') === window.__initialHeadline;
        window.__sdkSawPaint = performance.getEntriesByType('paint').some(p => p.name === 'first-contentful-paint');
        window.__metaCalls.push(...window.fbq.queue);
        window.fbq.callMethod = (...args) => window.__metaCalls.push(args);
        window.__sdkReady = true;
      ` });
    } else await route.abort();
  });
  if (signedIn) assert.equal((await context.request.post(BASE + "/api/auth/signin", { data: DEMO })).status(), 200);
  return context;
}

try {
  browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(existsSync(localChromium) ? { executablePath: localChromium } : {});
  // The new canonical size is a real resized image, not only browser markup.
  const response = await fetch(BASE + "/examples/hero-1.webp?w=180&v=5");
  // This store has no generated examples; populate only this local fixture.
  assert.equal(response.status, 404);
  const { putFile } = await import("../../lib/storage.js");
  await putFile("examples/hero-1.jpg", await sharp(Buffer.from(portraitSVG("size-check"))).resize(900, 1200).jpeg().toBuffer(), "image/jpeg");
  const resized = await fetch(BASE + "/examples/hero-1.webp?w=180&v=5");
  assert.equal(resized.status, 200);
  assert.equal((await sharp(Buffer.from(await resized.arrayBuffer())).metadata()).width, 180);
  assert.match(resized.headers.get("cache-control"), /s-maxage/);
  pass("180px example variant retains canonical caching and real dimensions");
  for (const width of [390, 1280]) for (const signedIn of [false, true]) {
    const context = await contextFor({ width, signedIn });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "/");
    await page.waitForFunction(() => window.fbq && !window.__sdkReady);
    await page.evaluate(async () => {
      const { pixel } = await import(new URL("./pixel.js", document.querySelector('script[type="module"][src*="app.js"]').src).href);
      pixel("Lead", { content_name: "startup fixture" }, "startup-lead");
    });
    await page.waitForFunction(() => window.__sdkReady);
    assert.equal(await page.evaluate(() => document.querySelector(".hero h1") === window.__initialHeadline), true);
    assert.equal(await page.evaluate(() => window.__sdkKeptHeadline), true);
    await page.waitForFunction(() => document.getElementById("customers").hidden);
    assert.equal(await page.evaluate(() => document.getElementById("customers") === window.__initialCustomers && !window.__initialCustomers.textContent), true);
    // Safari doesn't expose paint timing; the DOM identity check applies there.
    if (process.env.BROWSER !== "webkit") assert.equal(await page.evaluate(() => window.__sdkSawPaint), true);
    assert.equal(await page.evaluate(() => window.__metaCalls.filter((c) => c[0] === "track" && c[1] === "PageView").length), 1);
    assert.equal(await page.evaluate(() => window.__metaCalls.find((c) => c[1] === "Lead")?.[3]?.eventID), "startup-lead");
    assert.equal(await page.locator(".hero-ctas a").first().getAttribute("href"), signedIn ? "/app/new" : "/signup");
    await page.waitForFunction(() => [...document.querySelectorAll(".sheet-frame img")].every((im) => im.complete && im.naturalWidth));
    assert.equal(new URL(await page.locator(".sheet-frame img").first().evaluate((im) => im.currentSrc)).searchParams.get("w"), "180");
    if (width === 390) {
      await page.locator("#navToggle").click();
      assert.equal(await page.locator("#navToggle").getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#navToggle").getAttribute("aria-expanded"), "false");
    }
    await page.locator('[data-set="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-set="1"]').getAttribute("aria-pressed") === "true");
    assert.match(await page.locator(".sheet-frame img").first().getAttribute("srcset"), /p1-1/);
    assert.match(await page.locator(".sheet-frame img").first().evaluate((im) => im.currentSrc), /p1-1/);
    await page.locator("#heroPause").click();
    assert.equal(await page.locator("#heroPause").getAttribute("aria-label"), "Pause examples");
    await page.locator("#heroPause").click();
    assert.equal(await page.locator("#heroPause").getAttribute("aria-label"), "Play examples");
    if (width === 390) await page.locator("#navToggle").click();
    await page.locator(`${width === 390 ? "#navSheet" : "#nav .nav-links"} a[data-link][href="/team-headshots"]`).click();
    await page.waitForURL(BASE + "/team-headshots");
    await page.locator("#main h1").waitFor();
    await page.goBack();
    await page.locator(".hero h1").waitFor();
    await page.locator('[data-set="2"]').click();
    await page.waitForFunction(() => document.querySelector('[data-set="2"]').getAttribute("aria-pressed") === "true");
    assert.equal(await page.evaluate(() => window.__metaCalls.filter((c) => c[0] === "track" && c[1] === "PageView").length), 3);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    pass(`${width}px ${signedIn ? "signed-in" : "anonymous"}: retained content, tracking, destinations, controls and SPA return`);
    await context.close();
  }
  for (const scale of [2, 3]) {
    const context = await contextFor({ scale });
    const page = await context.newPage();
    await page.goto(BASE + "/");
    await page.waitForFunction(() => window.__sdkReady);
    await page.waitForFunction(() => document.querySelector(".sheet-frame img").complete);
    const chosen = new URL(await page.locator(".sheet-frame img").first().evaluate((im) => im.currentSrc)).searchParams.get("w");
    assert.equal(chosen, scale === 2 ? "180" : "360");
    pass(`phone DPR ${scale}: appropriate responsive source`);
    await context.close();
  }
  for (const mode of ["stalled-frames", "failed-session", "late-privacy"]) {
    const context = await contextFor({ stalledFrames: mode !== "failed-session", failedSession: mode === "failed-session" });
    const page = await context.newPage();
    await page.goto(BASE + "/");
    if (mode === "late-privacy") {
      const requests = [];
      page.on("request", (r) => r.url().endsWith("/fbevents.js") && requests.push(r.url()));
      await page.waitForFunction(() => window.fbq, null, { polling: 50 });
      await page.evaluate(() => Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true }));
      await page.waitForTimeout(2200);
      assert.deepEqual(requests, []);
      assert.equal(await page.evaluate(() => Boolean(window.__sdkReady)), false);
    } else if (mode === "stalled-frames") {
      await page.waitForFunction(() => window.__sdkReady, null, { polling: 50 });
      assert.equal(await page.evaluate(() => window.__metaCalls.filter((c) => c[0] === "track" && c[1] === "PageView").length), 1);
    } else {
      await page.locator('[data-set="1"]').click();
      await page.waitForFunction(() => document.querySelector('[data-set="1"]').getAttribute("aria-pressed") === "true");
      assert.equal(await page.evaluate(() => typeof window.fbq), "undefined");
    }
    assert.equal(await page.evaluate(() => document.querySelector(".hero h1") === window.__initialHeadline), true);
    pass(`${mode}: homepage remains usable and queued tracking stays bounded`);
    await context.close();
  }
  console.log(`${passed} homepage cases passed`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
}
