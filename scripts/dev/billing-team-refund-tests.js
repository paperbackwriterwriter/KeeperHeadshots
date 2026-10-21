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
const { getJSON, updateJSON } = await import("../../lib/storage.js");
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
const refund = async (sid, amount = 2900) => {
  const s = sessions.get(sid);
  s.payment_intent.latest_charge.amount_refunded = amount;
  await send("charge.refunded", { id: s.payment_intent.latest_charge.id, object: "charge", payment_intent: s.payment_intent.id, amount: 2900, amount_refunded: amount });
};
const person = async (uid, email) => {
  await users.create({ id: uid, email, name: uid, createdAt: new Date().toISOString(), emailVerified: true, usage: {} });
  return users.byId(uid);
};
const look = { backdrop: BACKDROPS[0].id, outfit: OUTFITS[0].id };

const deletedTeam = async (tag, count = 3) => {
  const uid = `usr_retry_${tag}`, a = `cs_retry_${tag}_A`, b = `cs_retry_${tag}_B`;
  await person(uid, `${tag}-admin@example.com`);
  await buy(uid, a, "2026-10-01T00:00:00Z");
  await teams.saveTeam(await users.byId(uid), { name: "Retry Team", looks: [look] });
  const joined = [];
  for (let i = 0; i <= count; i++) {
    if (i === count) {
      // Any remaining A credits were spent on the admin's own shoots.
      await users.update(uid, (u) => void (u.credits = 0));
      await buy(uid, b, "2026-10-03T00:00:00Z");
    }
    const admin = await users.byId(uid), email = `${tag}-member${i}@example.com`;
    const { invite } = await teams.invite(admin, email);
    const member = await person(`usr_${tag}_${i}`, email);
    joined.push((await teams.accept(member, invite.token)).shootId);
    assert.equal((await shoots.getMeta(joined.at(-1))).team.paidBy, i === count ? b : a);
    await updateJSON(`teams/${admin.teamId}.json`, (t) => {
      t.invites[invite.id].joinedAt = `2026-10-02T00:00:0${i}Z`;
      return t;
    });
  }
  const admin = await users.byId(uid);
  await teams.removeTeam(admin.teamId);
  await users.remove(admin);
  return {
    uid, a, b, joined,
    paid: () => Promise.all(joined.map(async (sid) => teams.seatPaid(await shoots.getMeta(sid)))),
    record: () => getJSON(`teams/gone/${uid}.json`),
  };
};

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

  for (const [kind, amount, legacy] of [["full", 2900, false], ["partial", 966, false], ["legacy", 2900, true]]) {
    await test(`admin deletion after a ${kind} refund preserves another package's paid seat`, async () => {
      const uid = `usr_delete_${kind}`;
      const a = `cs_delete_${kind}_A`, b = `cs_delete_${kind}_B`;
      await person(uid, `${kind}-admin@example.com`);
      await buy(uid, a, "2026-10-01T00:00:00Z");
      await teams.saveTeam(await users.byId(uid), { name: "Deletion Team", looks: [look] });
      const joined = [];
      for (const [i, at] of [[1, "2026-10-02T00:00:00Z"], [2, "2026-10-04T00:00:00Z"]]) {
        if (i === 2) {
          // The other two A credits were spent on the admin's own shoots.
          await users.update(uid, (u) => void (u.credits = 0));
          await buy(uid, b, "2026-10-03T00:00:00Z");
        }
        const admin = await users.byId(uid);
        const email = `${kind}-member${i}@example.com`;
        const { invite: inv } = await teams.invite(admin, email);
        const member = await person(`usr_${kind}_member${i}`, email);
        const { shootId } = await teams.accept(member, inv.token);
        assert.equal((await shoots.getMeta(shootId)).team.paidBy, i === 1 ? a : b);
        // Make B the newer seat, without depending on clock resolution.
        await updateJSON(`teams/${admin.teamId}.json`, (t) => {
          t.invites[inv.id].joinedAt = at;
          if (legacy && i === 1) delete t.invites[inv.id].paidBy;
          return t;
        });
        if (legacy && i === 1) await shoots.updateMeta(shootId, (m) => void delete m.team.paidBy);
        joined.push(shootId);
      }
      const paid = () => Promise.all(joined.map(async (sid) => teams.seatPaid(await shoots.getMeta(sid))));
      await refund(a, amount);
      const admin = await users.byId(uid);
      assert.equal(admin.creditsOwed, 1);
      assert.deepEqual(await paid(), [false, true]);
      // Same ordering as POST /api/account/delete.
      await users.beginRemoval(uid);
      await teams.removeTeam(admin.teamId);
      await users.remove(admin);
      assert.equal(await users.byId(uid), null);
      assert.deepEqual(await paid(), [false, true], "deletion must not move the refund restriction onto package B's seat");
      await refund(a, amount); // webhook retries after deletion must preserve it too
      assert.deepEqual(await paid(), [false, true]);
    });
  }

  await test("a failed refund webhook retries its pending seats without touching another package", async () => {
    const f = await deletedTeam("webhook", 2);
    const session = sessions.get(f.a);
    session.payment_intent.latest_charge.amount_refunded = 2900;
    const payload = JSON.stringify({ id: "evt_retry_same_delivery", object: "event", type: "charge.refunded", data: { object: {
      id: session.payment_intent.latest_charge.id, object: "charge", payment_intent: session.payment_intent.id, amount: 2900, amount_refunded: 2900,
    } } });
    // Exercise the real HTTP handler, with the exact same signed event retried.
    Object.assign(process.env, { VERCEL: "1", SESSION_SECRET: "team-refund-retry-test-session-secret" });
    const { default: app } = await import("../../server.js");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const deliver = () => fetch(`http://127.0.0.1:${server.address().port}/api/billing/webhook`, {
      method: "POST", headers: { "content-type": "application/json", "stripe-signature": new Stripe("sk_test_team").webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }, body: payload,
    });
    const original = shoots.updateMeta;
    let failures = 0;
    shoots.updateMeta = async (...args) => {
      if (args[0] === f.joined[0] && failures++ === 0) throw new Error("temporary seat storage failure");
      return original(...args);
    };
    try {
      const first = await deliver();
      assert.ok(first.status >= 400, "a storage failure must not acknowledge the webhook as successful");
      assert.deepEqual(await f.paid(), [true, false, true]);
      const pending = await f.record();
      assert.equal(pending.handled[f.a] || 0, 0);
      assert.equal(pending.pending[f.a].seats.length, 2);
      shoots.updateMeta = original;
      assert.equal((await deliver()).status, 200);
      assert.deepEqual(await f.paid(), [false, false, true]);
      assert.equal((await f.record()).handled[f.a], 3);
      assert.ok(!(await f.record()).pending?.[f.a]);
      assert.equal((await deliver()).status, 200);
      assert.deepEqual(await f.paid(), [false, false, true]);
    } finally {
      shoots.updateMeta = original;
      await new Promise((r) => server.close(r));
    }
  });

  await test("a failed completion write retries a partial refund without taking an extra seat", async () => {
    const f = await deletedTeam("checkpoint");
    const original = fs.rename;
    let writes = 0;
    fs.rename = async (from, to) => {
      if (to === path.join(dir, `teams/gone/${f.uid}.json`) && ++writes === 2) throw new Error("temporary refund checkpoint failure");
      return original(from, to);
    };
    try {
      await assert.rejects(refund(f.a, 966), /temporary refund checkpoint failure/);
    } finally { fs.rename = original; }
    assert.equal(writes, 2);
    assert.deepEqual(await f.paid(), [true, true, false, true]);
    assert.equal((await f.record()).pending[f.a].refundedShoots, 1);
    await refund(f.a, 966);
    await refund(f.a, 966);
    assert.deepEqual(await f.paid(), [true, true, false, true]);
    assert.equal((await f.record()).handled[f.a], 1);
    assert.ok(!(await f.record()).pending?.[f.a]);
  });

  await test("concurrent larger and older refunds resume pending work without double deductions", async () => {
    const f = await deletedTeam("concurrent");
    const original = shoots.updateMeta;
    shoots.updateMeta = async () => { throw new Error("temporary pending refund failure"); };
    try { await assert.rejects(refund(f.a, 966), /temporary pending refund failure/); }
    finally { shoots.updateMeta = original; }
    assert.deepEqual(await f.paid(), [true, true, true, true]);
    await Promise.all([1, 3, 2, 3].map((target) => teams.unpaySeatsOfGoneOwner(f.uid, f.a, target)));
    assert.deepEqual(await f.paid(), [false, false, false, true]);
    assert.equal((await f.record()).handled[f.a], 3);
    assert.ok(!(await f.record()).pending?.[f.a]);
    assert.equal(await teams.unpaySeatsOfGoneOwner(f.uid, f.a, 1), 0);
    assert.deepEqual(await f.paid(), [false, false, false, true]);
  });
} finally {
  stripeStub.close();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
