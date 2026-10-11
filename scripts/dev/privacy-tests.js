// DEV/QA ONLY — real session API and browser startup, with all Meta requests
// intercepted locally. No real tracking, emails, payments, or AI calls.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const OUT = process.argv[2] || "privacy-shots";
await fs.mkdir(OUT, { recursive: true });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-privacy-"));
for (const key of Object.keys(process.env)) {
  if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  DATA_DIR: dir, SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
  VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "test", META_PIXEL_ID: "123456",
});
const { default: app } = await import("../../server.js");
delete process.env.VERCEL;
const { seed, DEMO } = await import("../seed.js");
await seed();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
const localChromium = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
let browser;
let passed = 0;
const illustrations = new Map();
const pass = (name) => { passed++; console.log(`PASS ${name}`); };

try {
  browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(existsSync(localChromium) ? { executablePath: localChromium } : {});
  for (const width of [390, 1280]) {
    for (const signedIn of [false, true]) {
      for (const signal of ["none", "header", "property", "both"]) {
        const header = signal === "header" || signal === "both";
        const property = signal === "property" || signal === "both";
        const context = await browser.newContext({
          viewport: { width, height: 900 }, reducedMotion: "reduce",
          extraHTTPHeaders: header ? { "Sec-GPC": "1" } : {},
        });
        // The temporary store has no marketing photos. Use the existing
        // layout audit's illustration fixtures rather than calling real AI.
        await context.route("**/examples/**", async (route) => {
          const url = new URL(route.request().url());
          const key = url.pathname + url.search;
          if (!illustrations.has(key)) illustrations.set(key, sharp(Buffer.from(portraitSVG(url.pathname, { outfit: "navy-suit" }))).resize(Number(url.searchParams.get("w") || 600)).webp().toBuffer());
          await route.fulfill({ contentType: "image/webp", body: await illustrations.get(key) });
        });
        await context.addInitScript((value) => {
          Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, get: () => value });
          window.__metaCalls = [];
        }, property);
        const requests = [];
        await context.route(/https:\/\/([^/]+\.)?(facebook\.net|facebook\.com)\//, async (route) => {
          requests.push(route.request().url());
          // Exercise the app's real SDK loader and queued calls while keeping
          // every SDK/configuration/beacon request inside this fixture.
          if (route.request().url().endsWith("/fbevents.js")) {
            await route.fulfill({ contentType: "application/javascript", body: `
              window.__metaCalls.push(...window.fbq.queue);
              window.fbq.callMethod = (...args) => window.__metaCalls.push(args);
              fetch("https://connect.facebook.net/signals/config/123456");
            ` });
          } else await route.fulfill({ contentType: "application/json", body: "{}" });
        });
        if (signedIn) {
          const response = await context.request.post(BASE + "/api/auth/signin", { data: DEMO });
          assert.equal(response.status(), 200);
        }
        const response = await context.request.get(BASE + "/api/me");
        const data = await response.json();
        assert.equal(Boolean(data.user), signedIn);
        assert.equal(data.meta.optOut, header);
        assert.equal(data.meta.pixelId, header ? null : "123456");
        assert.equal(response.headers()["cache-control"], "private, no-store");
        // A subsequent request with a different header must get its own answer.
        const other = await context.request.get(BASE + "/api/me", { headers: { "Sec-GPC": header ? "0" : "1" } });
        assert.equal((await other.json()).meta.optOut, !header);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const session = page.waitForResponse((r) => r.url() === BASE + "/api/me");
        await page.goto(BASE + (signedIn ? "/app" : "/signin"));
        const browserSession = await (await session).json();
        assert.equal(browserSession.meta.optOut, header);
        await page.locator(signedIn ? ".shoots:not([aria-busy='true'])" : "form").first().waitFor();
        await page.evaluate(async () => {
          const { pixel, initPixel } = await import(new URL("./pixel.js", document.querySelector('script[type="module"][src*="app.js"]').src).href);
          initPixel();
          pixel("Lead", {}, "privacy-test");
        });
        if (!header && !property) {
          await page.waitForFunction(() => window.__metaCalls.some((c) => c[0] === "track" && c[1] === "Lead"));
          assert.equal(requests.filter((url) => url.endsWith("/fbevents.js")).length, 1);
          await page.waitForFunction(() => window.__metaCalls.some((c) => c[0] === "init"));
          // Turning on the browser signal after initialization also stops events.
          const count = await page.evaluate(() => window.__metaCalls.length);
          await page.evaluate(async () => {
            Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true });
            const { pixel } = await import(new URL("./pixel.js", document.querySelector('script[type="module"][src*="app.js"]').src).href);
            pixel("Purchase", { value: 1 }, "opted-out-after-init");
          });
          assert.equal(await page.evaluate(() => window.__metaCalls.length), count);
        } else {
          assert.equal(await page.evaluate(() => typeof window.fbq), "undefined");
          assert.deepEqual(requests, []);
          // An existing fbq from another source must not bypass the event guard.
          assert.equal(await page.evaluate(async () => {
            let calls = 0;
            window.fbq = () => calls++;
            const { pixel } = await import(new URL("./pixel.js", document.querySelector('script[type="module"][src*="app.js"]').src).href);
            pixel("Purchase", {}, "opted-out-existing-sdk");
            return calls;
          }), 0);
        }
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (signal === "header") {
          await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all([...document.images].map((img) => {
              img.loading = "eager";
              return img.decode().catch(() => {});
            }));
          });
          await page.screenshot({ path: path.join(OUT, `header-${signedIn ? "dashboard" : "signin"}-${width}.png`), fullPage: true });
        }
        pass(`${width}px ${signedIn ? "signed-in" : "anonymous"}: ${signal} signal, request cache, SDK and events`);
        await context.close();
      }
    }
  }
  console.log(`${passed} privacy browser cases passed`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
}
