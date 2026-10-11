// DEV/QA ONLY — bounded history queries, stable pagination and rotating
// purchase reconciliation, using a temporary store and local Stripe broker.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-history-"));
for (const k of Object.keys(process.env)) if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|GOOGLE_|TURNSTILE_|SMTP_|STRIPE_)/.test(k)) delete process.env[k];
Object.assign(process.env, { DATA_DIR: dir, VERCEL: "1", SESSION_SECRET: "history-tests-history-tests-history-tests", STRIPE_SECRET_KEY: "sk_test_history" });
let listCalls = [];
let providerFailure = false;
let providerGate = null;
let sessions = [];
const provider = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  listCalls.push(Object.fromEntries(url.searchParams));
  if (providerGate) await providerGate;
  res.setHeader("content-type", "application/json");
  if (providerFailure) { res.writeHead(400); return res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "simulated list failure" } })); }
  const after = url.searchParams.get("starting_after");
  const start = after ? sessions.findIndex((s) => s.id === after) + 1 : 0;
  const limit = Number(url.searchParams.get("limit"));
  const data = sessions.slice(start, start + limit);
  res.end(JSON.stringify({ object: "list", data, has_more: start + data.length < sessions.length, url: "/v1/checkout/sessions" }));
});
provider.listen(0, "127.0.0.1");
await new Promise((r) => provider.once("listening", r));
process.env.STRIPE_API_BASE = `http://127.0.0.1:${provider.address().port}`;
const storage = await import("../../lib/storage.js");
const { users, shoots } = await import("../../lib/store.js");
const { listShootPage } = await import("../../lib/shoot-list.js");
const showcase = await import("../../lib/showcase.js");
const billing = await import("../../lib/billing.js");
const replica = await import("../../lib/billing.js?history-replica");
const { mapLimit } = await import("../../lib/collections.js");
const { hashPassword } = await import("../../lib/auth.js");
const { default: app } = await import("../../server.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
let passed = 0;
const pass = (s) => { passed++; console.log("PASS " + s); };
const user = { id: "usr_history", name: "History Tester", email: "history@example.com", createdAt: new Date().toISOString(), password: await hashPassword("password123"), emailVerified: true };
const originalRead = fs.readFile;
const originalReaddir = fs.readdir;
let measure = false;
let metaReads = 0, activeReads = 0, peakReads = 0, indexLists = 0, unrelatedReads = 0;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
fs.readFile = async function (file, ...args) {
  const name = String(file);
  const meta = measure && name.startsWith(path.join(dir, "shoots") + path.sep);
  if (measure && name.includes("/showcase/shc_other_")) unrelatedReads++;
  if (meta) { metaReads++; peakReads = Math.max(peakReads, ++activeReads); await delay(2); }
  try { return await originalRead.call(this, file, ...args); }
  finally { if (meta) activeReads--; }
};
fs.readdir = async function (file, ...args) {
  if (measure && String(file).startsWith(path.join(dir, "idx"))) indexLists++;
  return originalReaddir.call(this, file, ...args);
};

try {
  await users.create(user);
  const history = Array.from({ length: 1000 }, (_, i) => ({ id: `sht_history_${String(i).padStart(5, "0")}`, userId: user.id, name: `Shoot ${i}`, status: "draft", createdAt: new Date(Date.UTC(2025, 0, 1) + Math.floor(i / 3) * 3600_000).toISOString(), selfies: [], shots: [], check: { notes: "fixture ".repeat(500) } }));
  await mapLimit(history, 16, async (s) => {
    await storage.putJSON(`shoots/${s.id}.json`, s);
    await storage.putJSON(`idx/${user.id}/${s.id}`, { createdAt: s.createdAt });
  });
  const cold = await listShootPage(user.id);
  assert.equal(cold.shoots.length, 24);
  assert.equal(cold.shoots[0].id, history.at(-1).id);
  assert.equal((await storage.getJSON(`shoot-catalog/${user.id}.json`)).items.length, 1000);
  pass("legacy history builds a chronological ID/date catalog without losing shoots");

  measure = true;
  const started = performance.now();
  const warm = await listShootPage(user.id);
  const elapsedMs = performance.now() - started;
  assert.equal(metaReads, 24); assert.ok(peakReads <= 8); assert.equal(indexLists, 0);
  measure = false;
  pass(`a 1,000-shoot account reads only 24 live records with at most 8 concurrent reads (${elapsedMs.toFixed(1)}ms locally)`);

  const seen = new Set(warm.shoots.map((s) => s.id));
  let cursor = warm.nextCursor;
  while (cursor) {
    const page = await listShootPage(user.id, { cursor });
    for (const s of page.shoots) { assert.ok(!seen.has(s.id)); seen.add(s.id); }
    cursor = page.nextCursor;
  }
  assert.equal(seen.size, 1000);
  pass("all pages include each historical shoot once, including tied creation times");

  const newest = { ...history[0], id: "sht_newest", createdAt: new Date().toISOString() };
  await shoots.create(newest);
  const second = await listShootPage(user.id, { cursor: warm.nextCursor });
  assert.ok(!second.shoots.some((s) => seen.has(s.id) && warm.shoots.some((w) => w.id === s.id)));
  assert.ok(!second.shoots.some((s) => s.id === newest.id));
  assert.equal((await listShootPage(user.id)).shoots[0].id, newest.id);
  pass("new shoots appear on refresh without shifting or duplicating an existing cursor");
  const boundary = warm.shoots.at(-1);
  await shoots.remove(boundary);
  assert.deepEqual((await listShootPage(user.id, { cursor: warm.nextCursor })).shoots.map((s) => s.id), second.shoots.map((s) => s.id));
  pass("deleting the cursor's boundary record preserves the next page");
  await shoots.updateMeta(newest.id, (s) => { s.name = "Renamed"; s.status = "checked"; });
  assert.equal((await listShootPage(user.id)).shoots[0].name, "Renamed");
  assert.equal((await listShootPage(user.id)).shoots[0].status, "checked");
  pass("paged summaries use current metadata after status changes and renames");

  const login = await fetch(BASE + "/api/auth/signin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: "password123" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(BASE + "/api/shoots", { headers: { cookie } });
  const payload = await response.json();
  assert.equal(payload.shoots.length, 24); assert.ok(payload.nextCursor); assert.equal(payload.shoots[0].check, undefined);
  pass("the authenticated API returns a bounded page of compact summaries");
  for (const q of ["limit=0", "limit=49", "limit=NaN", "cursor=%23", "cursor=" + Buffer.from("null").toString("base64url")]) assert.equal((await fetch(BASE + "/api/shoots?" + q, { headers: { cookie } })).status, 400);
  await assert.rejects(listShootPage("usr_else", { cursor: warm.nextCursor }), (e) => e.status === 400);
  pass("invalid limits, malformed cursors and another account's cursors are rejected");

  await mapLimit(Array.from({ length: 200 }, (_, i) => i), 16, (i) => storage.putJSON(`showcase/shc_other_${String(i).padStart(12, "0")}.json`, { id: `shc_other_${String(i).padStart(12, "0")}`, userId: "usr_else", createdAt: new Date().toISOString(), status: "pending" }));
  const mine = { id: "shc_history_1234567890", userId: user.id, createdAt: new Date().toISOString(), status: "pending" };
  await storage.putJSON(`showcase/${mine.id}.json`, mine);
  assert.equal((await showcase.forUser(user.id)).id, mine.id);
  unrelatedReads = 0; measure = true;
  assert.equal((await showcase.forUser(user.id)).id, mine.id); measure = false;
  assert.equal(unrelatedReads, 0);
  pass("a customer's warmed showcase lookup reads no other customer's entries");
  assert.equal(await showcase.forUser("usr_empty"), null);
  unrelatedReads = 0; measure = true; assert.equal(await showcase.forUser("usr_empty"), null); measure = false; assert.equal(unrelatedReads, 0);
  pass("accounts with no shared photo cache an empty index instead of repeatedly scanning the site");
  await showcase.removeForUser(user.id);
  assert.equal(await storage.getJSON(`showcase/${mine.id}.json`), null);
  assert.equal(await storage.getJSON(`showcase-users/${user.id}.json`), null);
  pass("removing shared results removes both their entry and customer index");

  const buyer = { ...user, id: "usr_buyer", email: "buyer@example.com", stripeCustomerId: "cus_history", credits: 480, purchases: [] };
  sessions = Array.from({ length: 160 }, (_, i) => ({ id: `cs_history_${String(i).padStart(4, "0")}`, customer: buyer.stripeCustomerId, payment_status: "paid", amount_total: 2900, currency: "usd", metadata: { userId: buyer.id, shoots: "3", packageId: "essentials" }, payment_intent: { latest_charge: { amount: 2900, amount_refunded: i === 159 ? 2900 : 0 } } }));
  buyer.purchases = sessions.map((s) => ({ sessionId: s.id, packageId: "essentials", shoots: 3, amount: 2900, at: buyer.createdAt }));
  await users.create(buyer);
  await mapLimit(sessions, 16, (s) => storage.putJSON(`payments/${s.id}.json`, { sessionId: s.id, userId: buyer.id, shoots: 3, amount: 2900, granted: true }));
  listCalls = [];
  await Promise.all([billing.sync(buyer), replica.sync(buyer)]);
  assert.equal(listCalls.length, 2); assert.ok(listCalls.every((c) => c.limit === "50"));
  assert.equal((await storage.getJSON(`billing-sync/${buyer.id}.json`)).historyCursor, sessions[99].id);
  pass("two server instances coalesce a sync and request only recent and one historical page");
  listCalls = [];
  await replica.sync(buyer, { automatic: true }); assert.equal(listCalls.length, 0);
  pass("automatic dashboard checks honor a persisted cooldown across instances");
  await billing.sync(buyer);
  const oldRefund = await billing.sync(buyer);
  assert.equal(oldRefund.removed, 3); assert.equal((await users.byId(buyer.id)).credits, 477);
  assert.ok((await users.byId(buyer.id)).purchases.at(-1).refunded);
  assert.equal((await storage.getJSON(`billing-sync/${buyer.id}.json`)).historyCursor, null);
  pass("rotating history reaches an older refund beyond the initial 100 sessions and resets at the end");
  await billing.sync(buyer); await billing.sync(buyer);
  assert.equal((await billing.sync(buyer)).removed, 0); assert.equal((await users.byId(buyer.id)).credits, 477);
  pass("revisiting an older refund does not deduct credits twice");
  providerFailure = true;
  await assert.rejects(billing.sync(buyer)); providerFailure = false;
  const released = await storage.getJSON(`billing-sync/${buyer.id}.json`);
  assert.equal(released.leaseUntil, 0); assert.equal(released.nextAutoAt, 0);
  pass("a provider failure releases the lease and allows immediate retry");

  let releaseProvider;
  providerGate = new Promise((r) => { releaseProvider = r; });
  const pending = billing.sync(buyer);
  while (!(await storage.getJSON(`billing-sync/${buyer.id}.json`))?.leaseUntil) await delay(2);
  await users.beginRemoval(buyer.id); releaseProvider(); await pending; providerGate = null;
  assert.equal(await storage.getJSON(`billing-sync/${buyer.id}.json`), null);
  pass("account cancellation prevents a late billing worker from restoring its sync state");
  await users.remove(user);
  assert.equal(await storage.getJSON(`shoot-catalog/${user.id}.json`), null);
  assert.equal((await listShootPage(user.id)).shoots.length, 0);
  assert.equal(await storage.getJSON(`shoot-catalog/${user.id}.json`), null);
  pass("account erasure removes its catalog and later lookups cannot recreate it");

  let running = 0;
  await assert.rejects(mapLimit([0, 1, 2, 3], 2, async (i) => {
    running++; try { await delay(i ? 15 : 1); if (!i) throw new Error("stop"); } finally { running--; }
  }));
  assert.equal(running, 0);
  pass("bounded work waits for in-flight requests before propagating an error");
  console.log(`${passed}/${passed} passed`);
} finally {
  fs.readFile = originalRead; fs.readdir = originalReaddir;
  await new Promise((r) => server.close(r)); await new Promise((r) => provider.close(r));
  await fs.rm(dir, { recursive: true, force: true });
}
