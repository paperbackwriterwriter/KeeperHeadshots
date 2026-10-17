// DEV/QA ONLY — customers pay up front (lib/plan.js FREE_SHOOT_OFFERED off),
// in the browser: a new account's "New shoot" page offers the packages
// instead of a photo picker, and a signed-out "Choose a package" button
// opens sign-up rather than sign-in. A throwaway local store; no external
// services run.
//   node scripts/dev/pay-first-browser-tests.js [outDir]
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";

const OUT = process.argv[2] || "pay-first-shots";
await fs.mkdir(OUT, { recursive: true });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-payfirst-"));
for (const key of Object.keys(process.env)) {
  if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_|FREE_SHOOT_OFFERED$)/.test(key)) delete process.env[key];
}
Object.assign(process.env, { DATA_DIR: dir, SESSION_SECRET: crypto.randomBytes(32).toString("hex"), NODE_ENV: "test" });
const { default: app } = await import("../../server.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
const localChromium = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
const browserType = process.env.BROWSER === "webkit" ? webkit : chromium;
const browser = await browserType.launch(browserType === chromium && existsSync(localChromium) ? { executablePath: localChromium } : {});
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const page = await ctx.newPage();

  await test("a signed-out \"choose a package\" link opens sign-up, keeping the package", async () => {
    await page.goto(`${BASE}/app/buy/starter`);
    await page.waitForURL(/\/signup\?next=%2Fapp%2Fbuy%2Fstarter/);
    assert.match(await page.locator("main").innerText(), /check out and upload a few selfies/i);
  });

  await test("a new account's New shoot page offers the packages, not a photo picker", async () => {
    const r = await page.request.post(`${BASE}/api/auth/signup`, { data: { name: "Pay First", email: `payfirst${Date.now()}@example.com`, password: "password123" } });
    assert.equal(r.status(), 201);
    await page.goto(`${BASE}/app/new`);
    await page.locator("#seePackages").waitFor();
    assert.equal(await page.locator("#dz, #file, #go").count(), 0);
    assert.equal(await page.locator("#seePackages").getAttribute("href"), "/#pricing");
    assert.match(await page.locator("[data-plan-banner]").innerText(), /Choose a package to start/);
    assert.doesNotMatch(await page.locator("main").innerText(), /free (preview|shoot)/i);
    await page.screenshot({ path: path.join(OUT, "new-shoot-390.png"), fullPage: true });
  });
  await ctx.close();
} finally {
  await browser.close();
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
process.exit(0);
