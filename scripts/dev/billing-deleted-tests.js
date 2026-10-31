// DEV/QA ONLY — Stripe webhooks for an account that was deleted while its
// checkout was open: the payment is recorded and flagged for a refund (not
// failed, which Stripe would retry for days), and a refund of it is accepted.
// A throwaway local store; no network.
//   node scripts/dev/billing-deleted-tests.js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-billing-deleted-"));
for (const key of Object.keys(process.env)) if (/^(BLOB_|BACKUP_|STRIPE_|STORAGE_NAMESPACE$)/.test(key)) delete process.env[key];
Object.assign(process.env, { DATA_DIR: dir, STRIPE_SECRET_KEY: "sk_test_deleted", STRIPE_WEBHOOK_SECRET: "whsec_deleted_tests" });
const { default: Stripe } = await import("stripe");
const storage = await import("../../lib/storage.js");
const { users } = await import("../../lib/store.js");
const { handleWebhook } = await import("../../lib/billing.js");

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
const signed = (event) => {
  const payload = JSON.stringify(event);
  return [payload, new Stripe("sk_test_deleted").webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })];
};
const errors = [];
const logError = console.error;
console.error = (...args) => { errors.push(args.join(" ")); logError(...args); };

try {
  const user = { id: "usr_deletedpay01", email: "gone@example.com", name: "Gone", createdAt: new Date().toISOString(), emailVerified: true, usage: {} };
  await users.create(user);
  await users.remove(await users.byId(user.id));
  const session = { id: "cs_test_deleted01", object: "checkout.session", payment_status: "paid", status: "complete", amount_total: 3900, currency: "usd", client_reference_id: user.id, metadata: { userId: user.id, packageId: "professional", shoots: "6" }, total_details: {} };

  await test("a payment for a deleted account is recorded and flagged for a refund, not failed", async () => {
    await handleWebhook(...signed({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: session } }));
    const rec = await storage.getJSON(`payments/${session.id}.json`);
    assert.equal(rec?.orphaned, true, JSON.stringify(rec));
    assert.ok(errors.some((e) => e.includes(session.id) && /may need a refund: the account was deleted/.test(e)), errors.join("\n"));
  });
  await test("the same webhook again is accepted, not failed", async () => {
    await handleWebhook(...signed({ id: "evt_2", object: "event", type: "checkout.session.completed", data: { object: session } }));
  });

  // "Keep all + 2 more looks" for a shoot deleted while checkout was open.
  const keeper = { id: "usr_deletedshoot01", email: "keeper@example.com", name: "Kay Per", createdAt: new Date().toISOString(), emailVerified: true, usage: {} };
  await users.create(keeper);
  const plus = { ...session, id: "cs_test_goneshoot01", amount_total: 1499, client_reference_id: keeper.id, metadata: { userId: keeper.id, packageId: "keep-plus", shoots: "0", shootId: "sht_neverthere01", looks: "2" } };
  await test("a $14.99 payment for a deleted shoot is recorded and flagged, not failed", async () => {
    await handleWebhook(...signed({ id: "evt_3", object: "event", type: "checkout.session.completed", data: { object: plus } }));
    const u = await users.byId(keeper.id);
    assert.equal(u.purchases?.length, 1, JSON.stringify(u.purchases));
    assert.equal(u.credits || 0, 0);
    assert.ok(!u.extraLooks?.sht_neverthere01);
    assert.ok(errors.some((e) => e.includes(plus.id) && /may need a refund: its shoot was deleted/.test(e)), errors.join("\n"));
  });
} finally {
  console.error = logError;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
