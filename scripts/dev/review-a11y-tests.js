// DEV/QA ONLY — keyboard and screen-reader behaviour of the review pages and
// the load errors that can pass (docs/qa/areas/H-ux.md H18-4, H18-5, H18-7):
// /app/review places focus after sending and deleting, announces a field error
// and moves to that field; /app/reviews names whose review each button acts on
// and keeps focus on the review after the list repaints; the join page says a
// time-out is not a broken invitation and offers Try again (as the team page,
// /app/review and /app/reviews do).
// Needs a local server wired to scripts/dev/mock-ai.js (as layout-ci.sh runs),
// with OWNER (default audit-owner@example.com) among OWNER_EMAILS:
//   BASE=http://localhost:3100 MOCK=http://localhost:4010 node scripts/dev/review-a11y-tests.js
// AXE=<path to axe-core's axe.min.js> also checks each page with axe (no violations).
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";

const BASE = process.env.BASE || "http://localhost:3100";
const MOCK = process.env.MOCK || "http://localhost:4010";
const OWNER = process.env.OWNER || "audit-owner@example.com";
const AXE = process.env.AXE && fs.readFileSync(process.env.AXE, "utf8");
const localChromium = process.env.CHROMIUM || "/opt/pw-browsers/chromium";

function client() {
  let cookie = "";
  const f = async (p, o = {}) => {
    const r = await fetch(BASE + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let j = null;
    try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  f.cookie = () => cookie;
  return f;
}
const t = Date.now();
// Names unique to this run (letters only: a store reused across runs keeps earlier reviews).
const run = (t % 1e7).toString(36).replace(/\d/g, (d) => "abcdefghij"[d]);
const RITA = `Rita O'Neil ${run}`, SAM = `Sam & Lee ${run}`;
async function account(email, name) {
  const f = client();
  const up = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password: "password123" }) });
  if (up.status !== 201) await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
  else {
    const link = (await fetch(`${MOCK}/mock-mail`).then((r) => r.json())).filter((m) => m.to.includes(email.toLowerCase())).flatMap((m) => m.links).filter((l) => l.includes("/verify?token=")).pop();
    await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: new URL(link).searchParams.get("token") }) });
  }
  return f;
}
async function customer(name) {
  const f = await account(`rva11y${t}${name[0]}@example.com`, name);
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const id = new URL(j.url).pathname.split("/").pop();
  await fetch(`${MOCK}/mock-pay/${id}`, { redirect: "manual" });
  await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: id }) });
  assert.equal((await f("/api/review/mine")).j?.eligible, true, "the customer may review");
  return f;
}

const browserType = process.env.BROWSER === "webkit" ? webkit : chromium;
const browser = await browserType.launch(browserType === chromium && fs.existsSync(localChromium) ? { executablePath: localChromium } : {});
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
const focused = (page) => page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, id: a.id, text: a.textContent.trim(), item: a.closest("[data-id]")?.dataset.id || null }; });
async function axe(page, name) {
  if (!AXE) return;
  await page.evaluate(AXE); // (not a script tag: the page's CSP refuses inline scripts)
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  assert.deepEqual(v, [], `axe on ${name}`);
}
async function pageFor(f) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  if (f) {
    const [k, v] = f.cookie().split("=");
    await ctx.addCookies([{ name: k, value: v, url: BASE }]);
  }
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  return page;
}

try {
  const rita = await customer(RITA);
  const sam = await customer(SAM);
  await sam("/api/review", { method: "POST", body: JSON.stringify({ rating: 4, text: "Quick and easy.", name: SAM, consent: true }) });
  const page = await pageFor(rita);

  await test("/app/review: a server error on the review text is announced, marked and focused", async () => {
    await page.goto(`${BASE}/app/review`);
    await page.locator("#rvForm").waitFor();
    await axe(page, "/app/review");
    await page.locator('label[for="rvStar5"]').click();
    await page.fill("#rvText", "Great, see www.example.com for mine");
    await page.fill("#rvName", RITA);
    await page.check("#rvConsent");
    await page.click("#rvForm button[type=submit]");
    await page.locator("#err-rvText:not([hidden])").waitFor();
    assert.equal(await page.getAttribute("#err-rvText", "role"), "alert");
    assert.match(await page.textContent("#err-rvText"), /web addresses/);
    assert.equal(await page.getAttribute("#rvText", "aria-invalid"), "true");
    assert.match(await page.getAttribute("#rvText", "aria-describedby"), /\berr-rvText\b/);
    assert.equal((await focused(page)).id, "rvText");
    for (const id of ["err-rvName", "err-rvRating", "err-rvConsent"]) assert.equal(await page.getAttribute(`#${id}`, "role"), "alert", id);
    await axe(page, "/app/review with a field error");
  });

  await test("/app/review: focus is on the heading after sending, and the field is no longer invalid", async () => {
    await page.fill("#rvText", "The headshots look like me.");
    await page.click("#rvForm button[type=submit]");
    await page.locator("#rvDelete").waitFor();
    const a = await focused(page);
    assert.equal(a.tag, "H1");
    assert.equal(await page.getAttribute("#rvText", "aria-invalid"), null);
    await axe(page, "/app/review with a review");
  });

  await test("/app/review: focus is on the heading after deleting", async () => {
    await page.click("#rvDelete");
    await page.locator("#rvDelete").waitFor({ state: "detached" });
    assert.equal((await focused(page)).tag, "H1");
    await page.locator('label[for="rvStar4"]').click();
    await page.fill("#rvName", RITA);
    await page.check("#rvConsent");
    await page.click("#rvForm button[type=submit]");
    await page.locator("#rvDelete").waitFor();
  });

  await test("/app/review: a time-out shows the message with Try again, which loads the page", async () => {
    let n = 0;
    await page.route("**/api/review/mine", (r) => (n++ ? r.fallback() : r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Storage timed out. Please try again." }) })));
    await page.goto(`${BASE}/app/review`);
    await page.locator("#rvRetry").waitFor();
    assert.match(await page.locator("#rvBody").innerText(), /Storage timed out/);
    await page.click("#rvRetry");
    await page.locator("#rvForm").waitFor();
    await page.unroute("**/api/review/mine");
  });
  await page.context().close();

  const owner = await account(OWNER, "Dana Owner");
  const op = await pageFor(owner);
  await test("/app/reviews: each button's name says whose review it acts on (escaped)", async () => {
    await op.goto(`${BASE}/app/reviews`);
    await op.locator(".rva-item").first().waitFor();
    for (const who of [RITA, SAM]) {
      for (const act of ["Approve", "Decline", "Delete"]) assert.equal(await op.getByRole("button", { name: `${act} the review from ${who}`, exact: true }).count(), 1, `${act} ${who}`);
    }
    await axe(op, "/app/reviews");
  });

  await test("/app/reviews: focus stays on the review after Approve and Decline repaint the list", async () => {
    const btn = op.getByRole("button", { name: `Approve the review from ${RITA}`, exact: true });
    const id = await btn.evaluate((b) => b.closest("[data-id]").dataset.id);
    await btn.click();
    await op.getByRole("button", { name: `Approve the review from ${RITA}`, exact: true }).waitFor({ state: "detached" });
    let a = await focused(op);
    assert.equal(a.item, id);
    assert.match(a.text, /Decline/);
    await op.keyboard.press("Enter"); // Decline, from where focus was put
    await op.getByRole("button", { name: `Approve the review from ${RITA}`, exact: true }).waitFor();
    a = await focused(op);
    assert.equal(a.item, id);
    assert.match(a.text, /Approve/);
  });

  await test("/app/reviews: after Delete, focus goes to the review that took its place", async () => {
    const items = await op.locator(".rva-item").evaluateAll((els) => els.map((e) => e.dataset.id));
    await op.locator(".rva-item").first().locator('[data-act="remove"]').click();
    await op.locator(`.rva-item[data-id="${items[0]}"]`).waitFor({ state: "detached" });
    const a = await focused(op);
    assert.equal(a.item, items[1]);
    await axe(op, "/app/reviews after a delete");
  });

  await test("/app/reviews and the team page: a time-out shows the message and a working Try again", async () => {
    let n = 0;
    await op.route("**/api/owner/reviews", (r) => (n++ ? r.fallback() : r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Storage timed out. Please try again." }) })));
    await op.goto(`${BASE}/app/reviews`);
    await op.locator("#rvaRetry").waitFor();
    assert.match(await op.locator("#rvaBody").innerText(), /Couldn't load the reviews\.\s*Storage timed out/);
    await op.click("#rvaRetry");
    await op.locator(".rva-item").first().waitFor();
    let m = 0;
    await op.route("**/api/team", (r) => (m++ ? r.fallback() : r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Storage timed out. Please try again." }) })));
    await op.goto(`${BASE}/app/team`);
    await op.locator("#teamRetry").waitFor();
    assert.match(await op.locator("main").innerText(), /Storage timed out/);
    await op.click("#teamRetry");
    await op.locator("#teamRetry").waitFor({ state: "detached" });
    await op.waitForFunction(() => !/Couldn't load your team/.test(document.querySelector("main")?.innerText || ""));
  });
  await op.context().close();

  await test("join page: a time-out has a neutral heading and Try again; a bad link still says it doesn't work", async () => {
    const jp = await pageFor(null);
    let n = 0;
    const invite = { email: "new@example.com", status: "invited", team: { name: "Acme", ownerName: "Dana", looks: ["Glass office"] } };
    await jp.route("**/api/join/**", (r) => (n++ ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(invite) }) : r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Storage timed out. Please try again." }) })));
    await jp.goto(`${BASE}/join/inv_zz_timeout_token`);
    await jp.locator("#joinRetry").waitFor();
    assert.equal(await jp.locator("main h1").innerText(), "We couldn't load this invitation.");
    assert.match(await jp.locator("main").innerText(), /Storage timed out/);
    await axe(jp, "/join after a time-out");
    await jp.click("#joinRetry");
    await jp.getByRole("heading", { name: /Dana invited you to get your Acme headshot/ }).waitFor();
    assert.equal((await focused(jp)).tag, "H1");
    await jp.unroute("**/api/join/**");
    await jp.goto(`${BASE}/join/inv_zz_no_such_token`);
    await jp.locator("main h1").filter({ hasText: "This invitation doesn't work." }).waitFor();
    assert.equal(await jp.locator("#joinRetry").count(), 0);
    await axe(jp, "/join with a bad link");
    await jp.context().close();
  });
} finally {
  await browser.close();
}
console.log(`${passed} passed`);
