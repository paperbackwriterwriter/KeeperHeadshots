// DEV/QA ONLY — enforce the real page CSP in a browser. All advertising and
// gateway requests are fixtures; nothing is sent to Meta or the cloud hosts.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";
import sharp from "sharp";

const OUT = process.argv[2] || "gateway-csp-results";
await fs.mkdir(OUT, { recursive: true });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-gateway-"));
for (const key of Object.keys(process.env)) {
  if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, { DATA_DIR: dir, SESSION_SECRET: crypto.randomBytes(32).toString("hex"), VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "test", META_PIXEL_ID: "123456" });
const { default: app } = await import("../../server.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
// These are a primary and a fallback in this site's public Meta openbridge
// config. Deliberately independent of the production CSP string under test.
const hosts = [
  "https://xd-f1cf3d4fdb19408ea770fc6f80817dcb.ecs.us-east-1.on.aws",
  "https://bded8a3c6ae-1-1053047382554.us-central1.run.app",
];
const gateways = hosts.map((host) => `${host}/events?cee=no`);
const unwanted = [
  "https://unrelated.us-central1.run.app/events",
  "https://unrelated.ecs.us-east-1.on.aws/events",
  `${hosts[0]}.unrelated.example/events`,
  hosts[1].replace("https:", "http:") + "/events",
];
const photo = await sharp({ create: { width: 180, height: 240, channels: 3, background: "#d8ccae" } }).webp().toBuffer();
const sdk = `
  window.__gatewaySettled = null;
  const track = (...args) => {
    if (args[0] !== 'track') return;
    if (args[1] === 'PageView') window.__pageViews = (window.__pageViews || 0) + 1;
    const sends = [];
    window.__gatewaySettled = null;
    for (const url of ${JSON.stringify(gateways)}) sends.push(fetch(url, {
      method: 'POST', headers: {'Content-Type': 'text/plain'},
      body: JSON.stringify({event_name: args[1], event_id: args[3]?.eventID})
    }).then(() => true, () => false));
    Promise.all(sends).then(results => window.__gatewaySettled = results);
  };
  window.fbq.callMethod = track;
  for (const args of window.fbq.queue) track(...args);
`;
const results = [];
const executable = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
let browser;

async function setup({ width, oldPolicy = false, routePath = "/", signal = "none" }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", extraHTTPHeaders: signal === "header" || signal === "both" ? { "Sec-GPC": "1" } : {} });
  // A returning ad visitor (Meta's cookie), so the browser SDK loads (pixel.js pixelWanted).
  await context.addCookies([{ name: "_fbp", value: "fb.1.1700000000000.1", url: BASE }]);
  await context.addInitScript((property) => {
    Object.defineProperty(navigator, "globalPrivacyControl", { get: () => property });
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));
  }, signal === "property" || signal === "both");
  const requests = [];
  await context.route("**/examples/**", (r) => r.fulfill({ contentType: "image/webp", body: photo }));
  await context.route(/^https?:\/\//, async (r) => {
    if (r.request().url().startsWith(BASE + "/")) return r.fallback();
    requests.push({ url: r.request().url(), body: r.request().postData() });
    if (r.request().url().endsWith("/fbevents.js")) return r.fulfill({ contentType: "application/javascript", body: sdk });
    await r.fulfill({ contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: "fixture" });
  });
  if (oldPolicy) await context.route(BASE + routePath, async (r) => {
    const response = await r.fetch();
    const headers = response.headers();
    for (const host of hosts) headers["content-security-policy"] = headers["content-security-policy"].replace(" " + host, "");
    await r.fulfill({ response, headers });
  });
  const page = await context.newPage();
  const response = await page.goto(BASE + routePath);
  assert.equal(response.status(), 200);
  return { context, page, requests };
}

try {
  browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch(existsSync(executable) ? { executablePath: executable } : {});
  for (const width of [390, 1280]) for (const routePath of ["/", "/blog"]) for (const oldPolicy of [true, false]) {
    const { context, page, requests } = await setup({ width, routePath, oldPolicy });
    await page.waitForFunction(() => Array.isArray(window.__gatewaySettled));
    assert.deepEqual(await page.evaluate(() => window.__gatewaySettled), [!oldPolicy, !oldPolicy]);
    assert.equal(await page.evaluate(() => window.__pageViews), 1);
    const sent = requests.filter((r) => gateways.includes(r.url));
    assert.equal(sent.length, oldPolicy ? 0 : 2);
    if (oldPolicy) {
      await page.waitForFunction(() => window.__violations.filter((v) => v.directive === "connect-src").length === 2);
    } else {
      assert.deepEqual(await page.evaluate(() => window.__violations), []);
      assert.ok(sent.every((r) => JSON.parse(r.body).event_name === "PageView"));
      await page.evaluate(async () => {
        const { pixel } = await import(new URL("./pixel.js", document.querySelector('script[type="module"][src*="app.js"]').src).href);
        pixel("Lead", {}, "gateway-fixture-event");
      });
      await page.waitForFunction(() => Array.isArray(window.__gatewaySettled));
      assert.deepEqual(await page.evaluate(() => window.__gatewaySettled), [true, true]);
      const leads = requests.filter((r) => gateways.includes(r.url) && JSON.parse(r.body).event_name === "Lead");
      assert.equal(leads.length, 2);
      assert.ok(leads.every((r) => JSON.parse(r.body).event_id === "gateway-fixture-event"));
      const denied = await page.evaluate(async (urls) => Promise.all(urls.map((url) => fetch(url).then(() => false, () => true))), unwanted);
      assert.deepEqual(denied, unwanted.map(() => true));
      // Permitting a connection must not permit that host to execute scripts.
      await page.evaluate((url) => { const script = document.createElement("script"); script.src = url; document.head.append(script); }, hosts[0] + "/untrusted.js");
      await page.waitForFunction(() => window.__violations.some((v) => v.directive.startsWith("script-src")));
      assert.ok((await page.evaluate(() => window.__violations.filter((v) => v.directive === "connect-src").length)) >= unwanted.length);
      assert.deepEqual(requests.filter((r) => unwanted.includes(r.url) || r.url.endsWith("/untrusted.js")), []);
    }
    results.push({ width, routePath, oldPolicy, sent: sent.length, matchedEventIds: !oldPolicy });
    console.log(`PASS ${width}px ${routePath}: ${oldPolicy ? "original gateway block reproduced" : "exact gateways allowed, event IDs preserved, other hosts/scripts denied"}`);
    await context.close();
  }
  for (const width of [390, 1280]) for (const signal of ["header", "property", "both"]) {
    const { context, page, requests } = await setup({ width, signal });
    await page.locator("#heroPause").waitFor();
    await page.waitForTimeout(2300);
    assert.equal(await page.evaluate(() => typeof window.fbq), "undefined");
    assert.deepEqual(requests, []);
    results.push({ width, signal, sent: 0 });
    console.log(`PASS ${width}px ${signal}: no SDK or gateway request after privacy opt-out`);
    await context.close();
  }
  await fs.writeFile(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(`${results.length} gateway CSP cases passed`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
}
