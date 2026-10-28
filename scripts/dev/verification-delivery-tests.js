// DEV/QA ONLY — signup -> delivery feedback -> resend -> confirmation.
// Uses a throwaway store and local mail provider; runs in either browser
// used by the layout workflow. No real emails, payments, or AI requests.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const OUT = process.argv[2] || "verification-delivery-shots";
await fs.mkdir(OUT, { recursive: true });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-delivery-"));
for (const key of Object.keys(process.env)) {
  if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  DATA_DIR: dir, SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
  VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "test",
  // The confirm-your-email banner this checks gates the free shoot, so it's
  // only shown while one is offered (lib/plan.js).
  FREE_SHOOT_OFFERED: "1",
});
let delivery = "sent";
const messages = [];
const illustrations = new Map();
const provider = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  messages.push({ ...JSON.parse(body), accepted: delivery === "sent" });
  res.writeHead(delivery === "sent" ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify(delivery === "sent" ? { id: `mail-${messages.length}` } : { message: "Local provider unavailable" }));
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const mailKey = "re_local_qa";
const providerURL = `http://127.0.0.1:${provider.address().port}`;
Object.assign(process.env, {
  RESEND_API_KEY: mailKey, RESEND_BASE_URL: providerURL,
  ANTHROPIC_API_KEY: "sk-ant-local-qa", ANTHROPIC_BASE_URL: providerURL,
  GEMINI_API_KEY: "local-qa", GEMINI_BASE_URL: providerURL,
});
const { default: app } = await import("../../server.js");
// The import skipped the normal listener. Local HTTP fixtures now use the
// same non-Secure cookies as the ordinary development server.
delete process.env.VERCEL;
const { users } = await import("../../lib/store.js");
const { seed } = await import("../seed.js");
await seed();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
const localChromium = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
let browser;
let passed = 0;
const pass = (name) => { passed++; console.log(`PASS ${name}`); };
const screenshot = async (page, name) => {
  // Full-page captures include content below the viewport; load its lazy
  // illustrations before reviewing them, without changing production code.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => {
      img.loading = "eager";
      return img.decode().catch(() => {});
    }));
  });
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
};

try {
  browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(existsSync(localChromium) ? { executablePath: localChromium } : {});
  for (const width of [390, 1280]) {
    for (const mode of ["failed", "unconfigured", "sent"]) {
      delivery = mode === "failed" ? "failed" : "sent";
      process.env.RESEND_API_KEY = mode === "unconfigured" ? "" : mailKey;
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      // The throwaway store has no generated marketing photos. Use the same
      // illustration stand-ins as the existing layout audit, never real AI.
      await context.route("**/examples/**", async (route) => {
        const url = new URL(route.request().url());
        const key = url.pathname + url.search;
        if (!illustrations.has(key)) illustrations.set(key, sharp(Buffer.from(portraitSVG(url.pathname, { outfit: "navy-suit" }))).resize(Number(url.searchParams.get("w") || 600)).webp().toBuffer());
        await route.fulfill({ contentType: "image/webp", body: await illustrations.get(key) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (err) => errors.push(err.message));
      const email = `delivery-${crypto.randomUUID()}@example.com`;
      const before = messages.length;
      // Cover the ordinary /app/new destination as well as dashboard signup.
      await page.goto(BASE + (mode === "failed" ? "/signup" : "/signup?next=%2Fapp"));
      await page.locator("#name").fill("Delivery QA");
      await page.locator("#email").fill(email);
      await page.locator("#password").fill("local-qa-password");
      const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/signup");
      await page.locator("#submit").click();
      const signup = await response;
      const data = await signup.json();
      assert.equal(signup.status(), 201);
      assert.equal(data.verificationSent, mode === "sent");
      await page.waitForURL(mode === "failed" ? "**/app/new" : "**/app");
      const banner = page.locator(".verify-banner");
      const btn = page.locator("[data-resend-verify]");
      await banner.waitFor({ state: "visible" });
      const me = async () => (await (await context.request.get(BASE + "/api/me")).json()).user;
      assert.equal((await me()).id, data.user.id);
      assert.equal((await me()).emailVerified, false);
      assert.equal((await me()).plan.needsEmail, true);
      assert.equal(messages.length - before, mode === "unconfigured" ? 0 : 1);
      assert.doesNotMatch(await banner.innerText(), /we (emailed|sent)/i);
      assert.equal(await btn.isEnabled(), true);
      if (mode === "sent") {
        await page.locator(".toast.success").filter({ hasText: "We emailed a 6-digit code" }).waitFor();
        assert.equal(messages.at(-1).accepted, true);
        pass(`${width}px signup reports a sent email only after provider success`);
      } else {
        await page.locator(".toast.error").filter({ hasText: "Your account is ready, but we couldn't send" }).waitFor();
        assert.equal(await page.locator(".toast.success").filter({ hasText: "We emailed" }).count(), 0);
        pass(`${width}px ${mode} delivery keeps the account and explains the email failure`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await screenshot(page, `${mode}-${width}.png`);

      await page.reload();
      await banner.waitFor({ state: "visible" });
      assert.doesNotMatch(await banner.innerText(), /we (emailed|sent)/i);
      assert.match(await btn.innerText(), /Send another/);
      assert.equal((await me()).id, data.user.id);
      pass(`${width}px ${mode} delivery stays accurate and offers an email request after reload`);

      if (mode === "unconfigured") {
        const retry = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/verify/resend");
        await btn.click();
        assert.equal((await retry).status(), 503);
        await page.locator(".toast.error").filter({ hasText: "Email isn't set up" }).waitFor();
        assert.equal(await btn.isEnabled(), true);
        assert.equal(messages.length, before);
        assert.equal(await page.locator(".toast.success").count(), 0);
        pass(`${width}px missing configuration produces a retryable error without claiming delivery`);
      }
      if (mode === "failed") {
        const limited = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/verify/resend");
        await btn.click();
        assert.equal((await limited).status(), 429);
        await page.locator(".toast.error").filter({ hasText: "Wait a minute" }).waitFor();
        assert.equal(await btn.isEnabled(), true);
        assert.equal(messages.length - before, 1);
        pass(`${width}px immediate retry preserves the cooldown and restores the request button`);

        await page.locator(".toast-close").click();
        delivery = "sent";
        // Age only this fixture's reservation instead of waiting a minute.
        await users.update(data.user.id, (u) => { u.verifySends = u.verifySends.map((t) => t - 120_000); });
        const retry = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/verify/resend");
        await btn.click();
        assert.equal((await retry).status(), 200);
        await page.locator(".toast.success").filter({ hasText: "Sent. Check" }).waitFor();
        assert.equal(await btn.innerText(), "Email sent");
        assert.equal(messages.length - before, 2);
        assert.equal(messages.at(-1).accepted, true);
        assert.equal((await me()).id, data.user.id);
        await screenshot(page, `retry-sent-${width}.png`);
        pass(`${width}px a successful resend confirms delivery inside the same account`);

        const code = messages.at(-1).subject.match(/^\d{6}/)?.[0];
        assert.ok(code);
        await page.locator("#verifyCode").fill(code);
        const confirmed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/verify/code");
        await page.locator("[data-verify-code] button[type=submit]").click();
        assert.equal((await confirmed).status(), 200);
        await banner.waitFor({ state: "detached" });
        assert.equal((await me()).emailVerified, true);
        assert.equal((await me()).plan.needsEmail, false);
        pass(`${width}px the resent code confirms the mailbox and unlocks the free shoot`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  // Opening the emailed link must not confirm anything: mail scanners open
  // links (some run the page's script). Only the button press confirms.
  {
    delivery = "sent";
    process.env.RESEND_API_KEY = mailKey;
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const email = `link-${crypto.randomUUID()}@example.com`;
    const signup = await fetch(BASE + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Link QA", email, password: "local-qa-password" }) });
    assert.equal(signup.status, 201);
    const { user } = await signup.json();
    const mail = messages.filter((m) => JSON.stringify(m.to).includes(email)).at(-1);
    const token = JSON.stringify(mail).match(/\/verify\?token=([\w-]+\.\d+\.[\w-]+)/)?.[1];
    assert.ok(token);
    const posts = [];
    page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/auth/verify") posts.push(r.method()); });
    await page.goto(`${BASE}/verify?token=${token}`);
    const btn = page.locator("#confirmEmail");
    await btn.waitFor();
    await page.waitForTimeout(500);
    assert.deepEqual(posts, []);
    assert.equal((await users.byId(user.id)).emailVerified, false);
    assert.equal(new URL(page.url()).search, "");
    pass("opening the emailed link shows a button and confirms nothing");
    const confirmed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/verify");
    await btn.click();
    assert.equal((await confirmed).status(), 200);
    // The account was made elsewhere (by the API above), so this browser is
    // asked first (server.js /api/auth/verify).
    await page.getByRole("heading", { name: "Did you create this account?" }).waitFor();
    assert.equal((await users.byId(user.id)).emailVerified, false);
    await screenshot(page, "link-ask-390.png");
    await page.locator("#createdYes").click();
    await page.getByRole("heading", { name: "Email confirmed." }).waitFor();
    assert.equal((await users.byId(user.id)).emailVerified, true);
    await screenshot(page, "link-confirmed-390.png");
    pass("pressing the button confirms the address");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`${passed}/${passed} browser checks passed`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  provider.closeAllConnections();
  await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => provider.close(resolve))]);
  await fs.rm(dir, { recursive: true, force: true });
}
