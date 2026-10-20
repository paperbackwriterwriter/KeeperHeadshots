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
const stripeStub = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/v1/checkout/sessions")) return res.end(JSON.stringify({ object: "list", data: [session], has_more: false }));
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => stripeStub.listen(0, "127.0.0.1", r));
for (const key of Object.keys(process.env)) if (/^(BLOB_|BACKUP_|STRIPE_|STORAGE_NAMESPACE$)/.test(key)) delete process.env[key];
Object.assign(process.env, { DATA_DIR: dir, STRIPE_SECRET_KEY: "sk_test_dispute", STRIPE_WEBHOOK_SECRET: "whsec_dispute_tests", STRIPE_API_BASE: `http://127.0.0.1:${stripeStub.address().port}` });
const { default: Stripe } = await import("stripe");
const { users } = await import("../../lib/store.js");
const storage = await import("../../lib/storage.js");
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
  await test("a late or repeated dispute event after the win changes nothing", async () => {
    await send("charge.dispute.funds_withdrawn", dispute("won"));
    await send("charge.dispute.funds_reinstated", dispute("won"));
    assert.equal((await me()).credits, 3);
  });
} finally {
  stripeStub.close();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
