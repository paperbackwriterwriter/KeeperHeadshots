// DEV/QA ONLY — real authenticated pagination and retry/navigation behavior.
// A smaller supported API page size keeps screenshot fixtures readable.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";

const OUT = process.argv[2] || "dashboard-history-shots";
await fs.mkdir(OUT, { recursive: true });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-dashboard-history-"));
for (const k of Object.keys(process.env)) if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_)/.test(k)) delete process.env[k];
Object.assign(process.env, { DATA_DIR: dir, SESSION_SECRET: crypto.randomBytes(32).toString("hex"), VERCEL: "1", NODE_ENV: "test" });
const { users, shoots } = await import("../../lib/store.js");
const { hashPassword } = await import("../../lib/auth.js");
const { default: app } = await import("../../server.js");
const user = { id: "usr_history_browser", email: "history-browser@example.com", name: "Maya Okafor", password: await hashPassword("password123"), emailVerified: true, createdAt: new Date().toISOString() };
await users.create(user);
for (let i = 0; i < 7; i++) await shoots.create({ id: `sht_browser_${i}`, userId: user.id, name: `Portrait session ${i + 1}`, createdAt: new Date(Date.UTC(2026, 9, i + 1)).toISOString(), status: ["draft", "checked", "error"][i % 3], shots: [], selfies: [] });
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
let browser;
let passed = 0;
const pass = (name) => { passed++; console.log("PASS " + name); };
async function screenshot(page, name) {
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('.toast-close').forEach((b) => b.click()); });
  await page.waitForTimeout(650);
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}
try {
  browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await context.route(/^https:\/\//, (r) => r.abort());
    assert.equal((await context.request.post(BASE + "/api/auth/signin", { data: { email: user.email, password: "password123" } })).status(), 200);
    let failNext = false, release = null, entered = false, pageCalls = 0;
    await context.route(/\/api\/shoots(?:\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set("limit", "3");
      if (url.searchParams.has("cursor")) {
        pageCalls++;
        if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary history failure. Try again." }) }); }
        if (release) { entered = true; await release.promise; }
      }
      const response = await route.fetch({ url: url.href });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(BASE + "/app");
    await page.waitForFunction(() => document.querySelectorAll("a.shoot-card").length === 3);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "body::after { display:none!important }" });
    await screenshot(page, `first-${width}.png`);
    const button = page.getByRole("button", { name: "Show more shoots" });
    failNext = true;
    await button.click();
    await page.getByText("Temporary history failure. Try again.").waitFor();
    assert.equal(await page.locator("a.shoot-card").count(), 3);
    await button.waitFor({ state: "visible" });
    assert.equal(await button.isEnabled(), true);
    await button.click();
    await page.waitForFunction(() => document.querySelectorAll("a.shoot-card").length === 6);
    await button.click();
    await page.waitForFunction(() => document.querySelectorAll("a.shoot-card").length === 7);
    assert.equal(await button.isVisible(), false);
    const links = await page.locator("a.shoot-card").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    assert.equal(new Set(links).size, 7);
    assert.equal(links[0], "/app/shoot/sht_browser_6");
    assert.equal(links.at(-1), "/app/shoot/sht_browser_0");
    await screenshot(page, `complete-${width}.png`);
    pass(`pagination preserves ordering, retries without duplicates and hides at the end at ${width}px`);
    if (width === 1280) for (const w of [320, 375, 390, 412, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, outside: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => [e.tagName, e.className, e.textContent.slice(0, 50)]) }))));
    }
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE + "/app");
    await page.waitForFunction(() => document.querySelectorAll("a.shoot-card").length === 3);
    let finish;
    release = { promise: new Promise((r) => { finish = r; }) };
    await page.getByRole("button", { name: "Show more shoots" }).click();
    await page.waitForFunction(() => document.querySelector(".shoots + div button")?.disabled);
    while (!entered) await new Promise((r) => setTimeout(r, 5));
    await page.locator(".shoots + div button").evaluate((el) => el.click());
    assert.equal(pageCalls, 4);
    await page.evaluate(() => document.querySelector('a[href="/app/account"]').click());
    await page.waitForURL(BASE + "/app/account");
    finish(); release = null;
    await page.waitForTimeout(300);
    assert.equal(await page.locator("a.shoot-card").count(), 0);
    assert.equal(pageCalls, 4);
    assert.deepEqual(errors, []);
    pass(`an in-flight page disables repeat clicks and cannot alter another view at ${width}px`);
    await context.close();
  }
  pass("loaded history has no horizontal overflow at eight supported widths");
  console.log(`${passed}/${passed} passed`);
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
}
