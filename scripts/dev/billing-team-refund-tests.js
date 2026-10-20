// DEV/QA ONLY — refunds and team seats, through the Stripe webhook: refunding
// one package only touches the seats that package paid for, and a refund after
// the admin deleted their account marks that package's seats unpaid. A
// throwaway local store and a stand-in for Stripe's session lookup; no network.
//   node scripts/dev/billing-team-refund-tests.js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-billing-team-"));
const sessions = new Map();
const stripeStub = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  const pi = new URL(req.url, "http://x").searchParams.get("payment_intent");
  if (req.url.startsWith("/v1/checkout/sessions")) return res.end(JSON.stringify({ object: "list", data: [...sessions.values()].filter((s) => s.payment_intent.id === pi), has_more: false }));
  res.statusCode = 404;
  res.end("{}");
});
await new Promise((r) => stripeStub.listen(0, "127.0.0.1", r));
for (const key of Object.keys(process.env)) if (/^(BLOB_|BACKUP_|STRIPE_|STORAGE_NAMESPACE$)/.test(key)) delete process.env[key];
Object.assign(process.env, { DATA_DIR: dir, STRIPE_SECRET_KEY: "sk_test_team", STRIPE_WEBHOOK_SECRET: "whsec_team_tests", STRIPE_API_BASE: `http://127.0.0.1:${stripeStub.address().port}` });
const { default: Stripe } = await import("stripe");
const { users, shoots } = await import("../../lib/store.js");
const teams = await import("../../lib/teams.js");
const { handleWebhook } = await import("../../lib/billing.js");
const { BACKDROPS, OUTFITS } = await import("../../public/js/shared/catalog.js");

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
let n = 0;
const send = (type, object) => {
  const payload = JSON.stringify({ id: `evt_${++n}`, object: "event", type, data: { object } });
  return handleWebhook(payload, new Stripe("sk_test_team").webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }));
};
const buy = async (uid, sid, at) => {
  const s = {
    id: sid, object: "checkout.session", payment_status: "paid", status: "complete", amount_total: 2900, currency: "usd",
    client_reference_id: uid, metadata: { userId: uid, packageId: "starter", shoots: "3" }, total_details: {},
    payment_intent: { id: `pi_${sid}`, object: "payment_intent", latest_charge: { id: `ch_${sid}`, object: "charge", amount: 2900, amount_refunded: 0 } },
  };
  sessions.set(sid, s);
  await send("checkout.session.completed", s);
  // Purchases are ordered by time (lib/plan.js creditLots).
  await users.update(uid, (u) => void (u.purchases.find((p) => p.sessionId === sid).at = at));
};
const refund = async (sid) => {
  const s = sessions.get(sid);
  s.payment_intent.latest_charge.amount_refunded = 2900;
  await send("charge.refunded", { id: s.payment_intent.latest_charge.id, object: "charge", payment_intent: s.payment_intent.id, amount: 2900, amount_refunded: 2900 });
};
const person = async (uid, email) => {
  await users.create({ id: uid, email, name: uid, createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
  return users.byId(uid);
};
const look = { backdrop: BACKDROPS[0].id, outfit: OUTFITS[0].id };

try {
  await test("refunding one package leaves the team seats another package paid for", async () => {
    await person("usr_teamadmin01", "admin1@example.com");
    await buy("usr_teamadmin01", "cs_test_pkgA", "2026-10-01T00:00:00Z");
    // Package A's 3 shoots spent on the admin's own shoots.
    await users.update("usr_teamadmin01", (u) => void (u.credits = 0));
    await buy("usr_teamadmin01", "cs_test_pkgB", "2026-10-02T00:00:00Z");
    await teams.saveTeam(await users.byId("usr_teamadmin01"), { name: "Team One", looks: [look] });
    for (const i of [1, 2, 3]) await teams.invite(await users.byId("usr_teamadmin01"), `member${i}@example.com`);
    await refund("cs_test_pkgA");
    const admin = await users.byId("usr_teamadmin01");
    const team = await teams.getTeam(admin.teamId);
    const statuses = Object.values(team.invites).map((i) => i.status);
    assert.deepEqual(statuses, ["invited", "invited", "invited"]);
    assert.ok(!(admin.creditsOwed > 0), JSON.stringify(admin.creditsOwed));
  });

  await test("a refund after the admin deleted their account marks that package's seats unpaid", async () => {
    await person("usr_teamadmin02", "admin2@example.com");
    await buy("usr_teamadmin02", "cs_test_pkgC", "2026-10-03T00:00:00Z");
    await teams.saveTeam(await users.byId("usr_teamadmin02"), { name: "Team Two", looks: [look] });
    const joined = [];
    for (const i of [1, 2]) {
      const { invite: inv } = await teams.invite(await users.byId("usr_teamadmin02"), `seat${i}@example.com`);
      const member = await person(`usr_seatmember${i}`, `seat${i}@example.com`);
      joined.push((await teams.accept(member, inv.token)).shootId);
    }
    const admin = await users.byId("usr_teamadmin02");
    await teams.removeTeam(admin.teamId);
    await users.remove(admin);
    const before = await Promise.all(joined.map(async (sid) => teams.seatPaid(await shoots.getMeta(sid))));
    assert.deepEqual(before, [true, true]);
    await refund("cs_test_pkgC");
    // The package's 3 shoots: 1 was still unspent, and 2 were on these seats.
    const after = await Promise.all(joined.map(async (sid) => teams.seatPaid(await shoots.getMeta(sid))));
    assert.deepEqual(after, [false, false]);
    await refund("cs_test_pkgC"); // a repeated webhook changes nothing
  });
} finally {
  stripeStub.close();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
