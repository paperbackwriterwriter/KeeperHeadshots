// DEV/QA ONLY — chargebacks through the Stripe webhook: an inquiry (no money
// moved) takes nothing, a chargeback takes the package's shoots, and winning
// it gives them back, once. A throwaway local store and a stand-in for
// Stripe's session lookup; no network.
//   node scripts/dev/billing-dispute-tests.js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-billing-dispute-"));
const session = {
  id: "cs_test_dispute01", object: "checkout.session", payment_status: "paid", status: "complete", amount_total: 2900, currency: "usd",
  client_reference_id: "usr_dispute0001", metadata: { userId: "usr_dispute0001", packageId: "starter", shoots: "3" }, total_details: {},
  payment_intent: { id: "pi_dispute01", object: "payment_intent", latest_charge: { id: "ch_dispute01", object: "charge", amount: 2900, amount_refunded: 0 } },
};
// A third buyer, partly refunded before a dispute over the rest.
const partial = {
  ...session, id: "cs_test_dispute03", client_reference_id: "usr_dispute0003", metadata: { ...session.metadata, userId: "usr_dispute0003" },
  payment_intent: { id: "pi_dispute03", object: "payment_intent", latest_charge: { id: "ch_dispute03", object: "charge", amount: 2900, amount_refunded: 0 } },
};
// A second buyer who had used all 3 shoots before disputing.
const spent = {
  ...session, id: "cs_test_dispute02", client_reference_id: "usr_dispute0002", metadata: { ...session.metadata, userId: "usr_dispute0002" },
  payment_intent: { id: "pi_dispute02", object: "payment_intent", latest_charge: { id: "ch_dispute02", object: "charge", amount: 2900, amount_refunded: 0 } },
};
// Two buyers of "keep + 2 more looks" whose looks became a shoot when the
// shoot's selfies were removed (lib/store.js dropSelfies): one refunded, one disputed.
const looksSession = (n) => ({
  ...session, id: `cs_test_looks0${n}`, amount_total: 1499, client_reference_id: `usr_looks00000${n}`,
  metadata: { userId: `usr_looks00000${n}`, packageId: "keep-plus", shoots: "0", shootId: `sht_looks00000${n}`, looks: "2" },
  payment_intent: { id: `pi_looks0${n}`, object: "payment_intent", latest_charge: { id: `ch_looks0${n}`, object: "charge", amount: 1499, amount_refunded: 0 } },
});
const looks1 = looksSession(1);
const looks2 = looksSession(2);
const looks3 = looksSession(3);
const looks4 = looksSession(4);
const looks5 = looksSession(5);
const looks6 = looksSession(6);
// Another payment by the same buyer: a package, or a second "+ 2 looks".
const another = (s, id, extra) => ({ ...s, id, ...extra, payment_intent: { id: `pi_${id}`, object: "payment_intent", latest_charge: { id: `ch_${id}`, object: "charge", amount: extra.amount_total, amount_refunded: 0 } } });
const pack3 = another(looks3, "cs_test_pack03", { amount_total: 2900, metadata: { userId: looks3.metadata.userId, packageId: "starter", shoots: "3" } });
const looks4b = another(looks4, "cs_test_looks04b", { amount_total: 1499 });
const stripeStub = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  const pi = new URL(req.url, "http://x").searchParams.get("payment_intent");
  if (req.url.startsWith("/v1/checkout/sessions")) return res.end(JSON.stringify({ object: "list", data: [session, spent, partial, looks1, looks2, looks3, looks4, looks5, looks6, pack3, looks4b].filter((s) => s.payment_intent.id === pi), has_more: false }));
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => stripeStub.listen(0, "127.0.0.1", r));
for (const key of Object.keys(process.env)) if (/^(BLOB_|BACKUP_|STRIPE_|STORAGE_NAMESPACE$)/.test(key)) delete process.env[key];
Object.assign(process.env, { DATA_DIR: dir, STRIPE_SECRET_KEY: "sk_test_dispute", STRIPE_WEBHOOK_SECRET: "whsec_dispute_tests", STRIPE_API_BASE: `http://127.0.0.1:${stripeStub.address().port}` });
const { default: Stripe } = await import("stripe");
const { users, shoots, saveMedia, dropSelfies } = await import("../../lib/store.js");
const storage = await import("../../lib/storage.js");
const { publicUser } = await import("../../lib/auth.js");
const today = async () => (await storage.getJSON(`stats/days/${new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })}.json`)) || {};
const { handleWebhook } = await import("../../lib/billing.js");

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
let n = 0;
const send = (type, object) => {
  const payload = JSON.stringify({ id: `evt_${++n}`, object: "event", type, data: { object } });
  return handleWebhook(payload, new Stripe("sk_test_dispute").webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }));
};
const dispute = (status) => ({ id: "dp_dispute01", object: "dispute", amount: 2900, charge: "ch_dispute01", payment_intent: "pi_dispute01", status });
const me = () => users.byId("usr_dispute0001");

try {
  await users.create({ id: "usr_dispute0001", email: "dispute@example.com", name: "Disputer", createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
  await send("checkout.session.completed", session);
  assert.equal((await me()).credits, 3);

  await test("an inquiry (no money moved) takes nothing", async () => {
    await send("charge.dispute.created", dispute("warning_needs_response"));
    const u = await me();
    assert.equal(u.credits, 3);
    assert.ok(!u.purchases[0].refunded);
  });
  await test("a chargeback takes the package's shoots", async () => {
    await send("charge.dispute.funds_withdrawn", dispute("needs_response"));
    const u = await me();
    assert.equal(u.credits, 0);
    assert.equal(u.purchases[0].refunded, true);
    assert.equal((await today()).refunds, 2900);
  });
  await test("winning the chargeback gives the shoots and the purchase back", async () => {
    await send("charge.dispute.closed", dispute("won"));
    const u = await me();
    assert.equal(u.credits, 3);
    assert.ok(!u.purchases[0].refunded);
    const day = await today();
    assert.equal(day.refunds, 0, "the funnel's refund total");
    assert.equal(day.refunded, 0, "refunded orders");
  });
  await test("a late or repeated dispute event after the win changes nothing, in the funnel either", async () => {
    await send("charge.dispute.funds_reinstated", dispute("won"));
    await send("charge.dispute.funds_withdrawn", dispute("needs_response"));
    await send("charge.dispute.closed", dispute("won"));
    assert.equal((await me()).credits, 3);
    const day = await today();
    assert.equal(day.refunds, 0, "the funnel's refund total");
    assert.equal(day.refunded, 0, "refunded orders");
  });
  await test("winning a dispute over shoots already used gives back nothing extra", async () => {
    await users.create({ id: "usr_dispute0002", email: "spent@example.com", name: "Spent", createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
    await send("checkout.session.completed", spent);
    await users.update("usr_dispute0002", (u) => void (u.credits = 0)); // all 3 developed
    const d = { id: "dp_dispute02", object: "dispute", amount: 2900, charge: "ch_dispute02", payment_intent: "pi_dispute02" };
    await send("charge.dispute.funds_withdrawn", { ...d, status: "needs_response" });
    await send("charge.dispute.closed", { ...d, status: "won" });
    const u = await users.byId("usr_dispute0002");
    assert.equal(u.credits, 0);
    assert.ok(!u.purchases[0].refunded);
  });
  await test("a dispute won before its chargeback was booked leaves an earlier refund in the funnel", async () => {
    await users.create({ id: "usr_dispute0003", email: "partial@example.com", name: "Partial", createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
    await send("checkout.session.completed", partial);
    const before = (await today()).refunds || 0;
    partial.payment_intent.latest_charge.amount_refunded = 1000;
    await send("charge.refunded", { id: "ch_dispute03", object: "charge", payment_intent: "pi_dispute03", amount: 2900, amount_refunded: 1000 });
    assert.equal((await today()).refunds, before + 1000);
    const d = { id: "dp_dispute03", object: "dispute", amount: 1900, charge: "ch_dispute03", payment_intent: "pi_dispute03" };
    await send("charge.dispute.closed", { ...d, status: "won" }); // its funds_withdrawn comes later (a retry)
    await send("charge.dispute.funds_withdrawn", { ...d, status: "needs_response" });
    assert.equal((await today()).refunds, before + 1000, "the $10 refund still counts");
  });
  await test("a won dispute after a partial refund takes only the dispute's share off the funnel", async () => {
    const before = (await today()).refunds || 0;
    const d = { id: "dp_dispute04", object: "dispute", amount: 1900, charge: "ch_dispute03", payment_intent: "pi_dispute03" };
    // (Payment 03's earlier dispute was won, so a fresh one isn't booked; reset that for this case.)
    await storage.updateJSON("payments/cs_test_dispute03.json", (r) => { delete r.disputesWon; return r; });
    await send("charge.dispute.funds_withdrawn", { ...d, status: "needs_response" });
    assert.equal((await today()).refunds, before + 1900);
    await send("charge.dispute.closed", { ...d, status: "won" });
    assert.equal((await today()).refunds, before, "only the $19 dispute comes off");
  });
  // Bought 2 extra looks, then the shoot's selfies went (a takeover): the looks became 1 shoot.
  const looksBecameShoot = async (s) => {
    const uid = s.metadata.userId, sid = s.metadata.shootId;
    await users.create({ id: uid, email: `${uid}@example.com`, name: "L", createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await shoots.saveMeta({ id: sid, userId: uid, status: "done", createdAt: new Date().toISOString(), selfies: [{ file }], looks: [{ backdrop: "a", outfit: "b" }], shots: [], preview: true });
    await send("checkout.session.completed", s);
    assert.deepEqual((await users.byId(uid)).extraLooks, { [sid]: 2 });
    await dropSelfies(sid, { only: [file] });
    const u = await users.byId(uid);
    assert.equal(u.credits, 1);
    assert.ok(!u.extraLooks?.[sid]);
    return uid;
  };
  await test("a full refund of extra looks that became a shoot takes that shoot back", async () => {
    const uid = await looksBecameShoot(looks1);
    looks1.payment_intent.latest_charge.amount_refunded = 1499;
    await send("charge.refunded", { ...looks1.payment_intent.latest_charge, payment_intent: "pi_looks01" });
    const u = await users.byId(uid);
    assert.equal(u.credits, 0);
    assert.equal(u.purchases[0].refunded, true);
    assert.equal(publicUser(u).refundNotice, 1, "the customer is told the shoot went");
    assert.equal(publicUser(u).refundNotice, 1, "the customer is told the shoot went");
  });
  await test("a won dispute over looks that became a shoot gives back the shoot, not the looks too", async () => {
    const uid = await looksBecameShoot(looks2);
    const d = { id: "dp_looks02", object: "dispute", amount: 1499, charge: "ch_looks02", payment_intent: "pi_looks02" };
    await send("charge.dispute.funds_withdrawn", { ...d, status: "needs_response" });
    assert.equal((await users.byId(uid)).credits, 0);
    await send("charge.dispute.closed", { ...d, status: "won" });
    const u = await users.byId(uid);
    assert.equal(u.credits, 1);
    assert.ok(!u.extraLooks?.[looks2.metadata.shootId]);
  });
  const refundAll = (s) => {
    s.payment_intent.latest_charge.amount_refunded = s.payment_intent.latest_charge.amount;
    return send("charge.refunded", { ...s.payment_intent.latest_charge, payment_intent: s.payment_intent.id });
  };
  await test("refunding looks whose shoot was already spent never takes another package's shoots", async () => {
    const uid = await looksBecameShoot(looks3);
    await users.update(uid, (u) => void (u.credits = 0)); // the converted shoot was used
    await send("checkout.session.completed", pack3);
    await refundAll(looks3);
    assert.equal((await users.byId(uid)).credits, 3);
  });
  await test("only the looks still unused when the selfies went become the shoot", async () => {
    const uid = looks4.metadata.userId, sid = looks4.metadata.shootId;
    await users.create({ id: uid, email: `${uid}@example.com`, name: "L", createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await shoots.saveMeta({ id: sid, userId: uid, status: "done", createdAt: new Date().toISOString(), selfies: [{ file }], looks: [{ backdrop: "a", outfit: "b" }], shots: [], preview: true });
    await send("checkout.session.completed", looks4);
    await users.update(uid, (u) => void delete u.extraLooks[sid]); // developed
    await send("checkout.session.completed", looks4b);
    await dropSelfies(sid, { only: [file] });
    const marked = (await users.byId(uid)).purchases.map((p) => !!p.looksAsShoot);
    assert.deepEqual(marked, [false, true]);
    await refundAll(looks4b);
    assert.equal((await users.byId(uid)).credits, 0, "refunding the looks that became the shoot takes it back");
  });
  await test("a dispute won after the shoot lost its selfies gives back a shoot, not looks it can't use", async () => {
    const uid = looks5.metadata.userId, sid = looks5.metadata.shootId;
    await users.create({ id: uid, email: `${uid}@example.com`, name: "L", createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await shoots.saveMeta({ id: sid, userId: uid, status: "done", createdAt: new Date().toISOString(), selfies: [{ file }], looks: [{ backdrop: "a", outfit: "b" }], shots: [], preview: true });
    await send("checkout.session.completed", looks5);
    const d = { id: "dp_looks05", object: "dispute", amount: 1499, charge: "ch_looks05", payment_intent: "pi_looks05" };
    await send("charge.dispute.funds_withdrawn", { ...d, status: "needs_response" });
    await dropSelfies(sid, { only: [file] });
    await send("charge.dispute.closed", { ...d, status: "won" });
    const u = await users.byId(uid);
    assert.equal(u.credits, 1);
    assert.ok(!u.extraLooks?.[sid]);
  });
  await test("looks bought for a shoot that has no selfies come as a shoot", async () => {
    const uid = looks6.metadata.userId, sid = looks6.metadata.shootId;
    await users.create({ id: uid, email: `${uid}@example.com`, name: "L", createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
    await shoots.saveMeta({ id: sid, userId: uid, status: "done", createdAt: new Date().toISOString(), selfies: [], looks: [{ backdrop: "a", outfit: "b" }], shots: [], preview: true });
    await send("checkout.session.completed", looks6);
    const u = await users.byId(uid);
    assert.equal(u.credits, 1);
    assert.ok(!u.extraLooks?.[sid]);
    assert.equal(u.purchases[0].looksAsShoot, true);
  });
} finally {
  stripeStub.close();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
