// DEV/QA ONLY — what a takeover leaves behind (server.js purgeForTakeover):
// a shoot still developing keeps the earlier holder's selfies only until it
// finishes, and the earlier holder's browsers stop counting as known devices.
// Also the one-time refund notice (lib/auth.js refundNotice). A throwaway
// local store; no network.
//   node scripts/dev/takeover-tests.js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-takeover-"));
for (const key of Object.keys(process.env)) if (/^(BLOB_|BACKUP_|STRIPE_|STORAGE_NAMESPACE$)/.test(key)) delete process.env[key];
Object.assign(process.env, { DATA_DIR: dir, SESSION_SECRET: "takeover-tests-secret-takeover-tests" });
const { users, shoots, saveMedia, readMedia, writeMedia, deleteMedia, dropSelfies, shootFinished } = await import("../../lib/store.js");
const { MAX_RESUMES } = await import("../../public/js/shared/catalog.js");
const { setSession, knownDevice, publicUser } = await import("../../lib/auth.js");
const teams = await import("../../lib/teams.js");

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };

try {
  await test("a developing shoot marked at takeover keeps its selfies until it finishes, then loses them", async () => {
    const sid = "sht_takeover01";
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await shoots.saveMeta({ id: sid, userId: "usr_takeover01", status: "generating", createdAt: new Date().toISOString(), selfies: [{ file }], check: { photos: [{ file }] }, dropSelfies: [file] });
    assert.equal(await dropSelfies(sid, { whenFinished: true }), 0, "still developing");
    assert.equal((await shoots.getMeta(sid)).selfies.length, 1);
    await shoots.updateMeta(sid, (m) => void (m.status = "done"));
    assert.equal(await dropSelfies(sid, { whenFinished: true }), 1);
    const meta = await shoots.getMeta(sid);
    assert.equal(meta.selfies.length, 0);
    assert.equal(meta.check, null, "its photo check goes with its selfies");
    assert.ok(!meta.dropSelfies);
    assert.equal(await readMedia(file), null, "the photo itself is gone");
  });
  await test("a failed shoot waiting for its retry keeps its selfies", async () => {
    const sid = "sht_takeover05";
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await shoots.saveMeta({ id: sid, userId: "usr_takeover05", status: "error", createdAt: new Date().toISOString(), selfies: [{ file }], dropSelfies: [file], shots: [{ id: "shot_e1" }] });
    await shoots.saveShot(sid, { id: "shot_e1", status: "error" });
    assert.equal(await dropSelfies(sid, { whenFinished: true }), 0);
    assert.ok(await readMedia(file));
  });
  await test("so does a developed shoot with failed frames still to retry, until its retries run out", async () => {
    const sid = "sht_takeover08";
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await shoots.saveMeta({ id: sid, userId: "usr_takeover08", status: "done", createdAt: new Date().toISOString(), selfies: [{ file }], dropSelfies: [file], shots: [{ id: "shot_d1" }, { id: "shot_d2" }] });
    await shoots.saveShot(sid, { id: "shot_d1", status: "done", file: `${sid}/x.jpg` });
    await shoots.saveShot(sid, { id: "shot_d2", status: "error" });
    assert.equal(await shootFinished(sid), false);
    assert.equal(await dropSelfies(sid, { whenFinished: true }), 0);
    assert.ok(await readMedia(file));
    await shoots.updateMeta(sid, (m) => void (m.resumes = MAX_RESUMES));
    assert.equal(await shootFinished(sid), true);
    assert.equal(await dropSelfies(sid, { whenFinished: true }), 1);
  });
  await test("only the photos recorded at the takeover go, not ones added since", async () => {
    const sid = "sht_takeover06";
    const theirs = await saveMedia(sid, Buffer.from("earlier holder"));
    const mine = await saveMedia(sid, Buffer.from("new holder"));
    await shoots.saveMeta({ id: sid, userId: "usr_takeover06", status: "done", createdAt: new Date().toISOString(), selfies: [{ file: theirs }, { file: mine }] });
    assert.equal(await dropSelfies(sid, { only: [theirs] }), 1);
    assert.deepEqual((await shoots.getMeta(sid)).selfies.map((p) => p.file), [mine]);
    assert.ok(await readMedia(mine));
  });
  await test("extra looks bought for a shoot that loses all its selfies become a shoot on the account", async () => {
    const sid = "sht_takeover09";
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await users.create({ id: "usr_takeover09", email: "looks@example.com", name: "Looks", createdAt: new Date().toISOString(), emailVerified: true, usage: {}, credits: 0, extraLooks: { [sid]: 2 } });
    await shoots.saveMeta({ id: sid, userId: "usr_takeover09", status: "done", createdAt: new Date().toISOString(), selfies: [{ file }], check: { overall_score: 84, photos: [{ index: 0 }] } });
    assert.equal(await dropSelfies(sid, { only: [file] }), 1);
    const u = await users.byId("usr_takeover09");
    assert.equal(u.credits, 1);
    assert.ok(!u.extraLooks?.[sid]);
    assert.equal((await shoots.getMeta(sid)).check, null, "the earlier photo check (and its score) goes too");
  });
  await test("a develop that fails gives its credit back, unless a refund of its package took it meanwhile", async () => {
    const at = "2026-10-29T08:00:00.000Z";
    const plain = { credits: 2, developing: { sht_a: { charged: "credit", paidBy: "cs_1", at } } };
    teams.undoDevelopCharge(plain, "sht_a");
    assert.equal(plain.credits, 3);
    assert.ok(!plain.developing.sht_a);
    // Fully refunded meanwhile: 3 shoots removed, only the 2 on the balance taken.
    const refunded = { credits: 0, developing: { sht_a: { charged: "credit", paidBy: "cs_1", at } }, refunds: [{ sessionId: "cs_1", shootsRemoved: 3, creditsTaken: 2, owedAdded: 0, at: "2026-10-29T08:00:01.000Z" }] };
    teams.undoDevelopCharge(refunded, "sht_a");
    assert.equal(refunded.credits, 0);
    assert.equal(refunded.refunds[0].creditsTaken, 3, "recorded as taken, so a won dispute gives it back");
    // A charge left behind by a develop that died, for a shoot that's gone: it comes back once.
    const stranded = { credits: 0, developing: { sht_b: { charged: "credit", paidBy: "cs_1", at } } };
    assert.equal(teams.releaseDeveloping(stranded, "sht_b"), true);
    assert.equal(teams.releaseDeveloping(stranded, "sht_b"), false);
    assert.equal(stranded.credits, 1);
  });
  await test("a team keeps a name saved before the web-address rule; a new one like it is refused", async () => {
    const { putJSON } = await import("../../lib/storage.js");
    await putJSON("teams/team_oldname01.json", { id: "team_oldname01", ownerId: "usr_oldname01", name: "Node.js Guild", looks: [], invites: {} });
    const owner = { id: "usr_oldname01", name: "Owner", teamId: "team_oldname01" };
    const looks = [{ backdrop: "studio-gray", outfit: "navy-suit" }];
    const saved = await teams.saveTeam(owner, { name: "Node.js Guild", looks });
    assert.equal(saved.name, "Node.js Guild");
    await assert.rejects(teams.saveTeam(owner, { name: "Visit shop.xyz", looks }), (e) => e.code === "team_name");
  });
  await test("deleting a photo deletes its cached square and sizes too", async () => {
    const sid = "sht_takeover07";
    const file = await saveMedia(sid, Buffer.from("selfie"));
    const stem = file.replace(/\.jpg$/, "");
    for (const copy of [`${stem}-sq.jpg`, `${stem}-li.jpg`, `${stem}-banner.jpg`, `${stem}-sig.png`]) await writeMedia(copy, Buffer.from("copy"));
    const other = await saveMedia(sid, Buffer.from("another"));
    await deleteMedia(file);
    for (const copy of [`${stem}-sq.jpg`, `${stem}-li.jpg`, `${stem}-banner.jpg`, `${stem}-sig.png`]) assert.equal(await readMedia(copy), null, copy);
    assert.ok(await readMedia(other), "other photos stay");
  });
  await test("a finished shoot that wasn't taken over keeps its selfies", async () => {
    const sid = "sht_takeover02";
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await shoots.saveMeta({ id: sid, userId: "usr_takeover02", status: "done", createdAt: new Date().toISOString(), selfies: [{ file }] });
    assert.equal(await dropSelfies(sid, { whenFinished: true }), 0);
    assert.ok(await readMedia(file));
  });
  await test("after a takeover, the earlier holder's browser is no longer a known device", async () => {
    const cookies = {};
    setSession({ cookie: (name, value) => (cookies[name] = value) }, { id: "usr_takeover03", sessionVersion: 0 });
    const req = { cookies };
    assert.equal(knownDevice(req, { id: "usr_takeover03" }), true);
    assert.equal(knownDevice(req, { id: "usr_takeover03", deviceEpoch: 1 }), false);
  });
  await test("a refund's shoots are announced once; chargebacks and refunds from before notices aren't", async () => {
    const at = new Date().toISOString();
    const base = { id: "usr_takeover04", email: "n@example.com", name: "Notice", createdAt: at, usage: {} };
    assert.equal(publicUser({ ...base, refunds: [{ sessionId: "cs_1", shootsRemoved: 2, at }] }).refundNotice, 2);
    assert.equal(publicUser({ ...base, refunds: [{ sessionId: "cs_1", shootsRemoved: 2, at, noticeSeenAt: at }] }).refundNotice, 0);
    assert.equal(publicUser({ ...base, refunds: [{ sessionId: "cs_1", shootsRemoved: 2, at, disputed: true }] }).refundNotice, 0);
    assert.equal(publicUser({ ...base, refunds: [{ sessionId: "cs_1", shootsRemoved: 2, at: "2026-10-01T00:00:00.000Z" }] }).refundNotice, 0);
    // What came off the balance, not shoots already spent.
    assert.equal(publicUser({ ...base, refunds: [{ sessionId: "cs_1", shootsRemoved: 3, creditsTaken: 1, owedAdded: 0, at }] }).refundNotice, 1);
    assert.equal(publicUser({ ...base, refunds: [{ sessionId: "cs_1", shootsRemoved: 3, creditsTaken: 0, owedAdded: 0, at }] }).refundNotice, 0);
    assert.equal(publicUser({ ...base, refunds: [{ sessionId: "cs_1", shootsRemoved: 2, at }] }).refundNoticeAt, at);
  });
  await test("\"No, it wasn't me\" that saved but timed out: opening the link again offers to set a password, not to sign in", async () => {
    // (An in-process app on this store, so the write can land and then throw
    // StorageTimeoutError, as a slow Blob write does: A20-5.)
    for (const key of Object.keys(process.env)) if (/^(ANTHROPIC_|GEMINI_|RESEND_|META_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_)/.test(key)) delete process.env[key];
    Object.assign(process.env, { VERCEL: "1", NODE_ENV: "test" });
    const { default: app } = await import("../../server.js");
    const { StorageTimeoutError } = await import("../../lib/storage.js");
    const { emailToken, hashPassword } = await import("../../lib/auth.js");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const verify = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json() }));
    const fsp = (await import("node:fs/promises")).default;
    const realRename = fsp.rename;
    try {
      const user = await users.create({ id: "usr_takeover10", email: "notme@example.com", name: "Not Me", password: await hashPassword("someone-elses1"), emailVerified: false, originDevice: "elsewhere", createdAt: new Date().toISOString(), usage: {} });
      const token = emailToken(user);
      const record = path.join(dir, "users", "id", `${user.id}.json`);
      fsp.rename = async (from, to) => {
        if (to !== record) return realRename(from, to);
        fsp.rename = realRename;
        await realRename(from, to); // lands…
        throw new StorageTimeoutError("write", `users/id/${user.id}.json`, 20000); // …but reports a time-out
      };
      assert.equal((await verify({ token, created: false })).status, 503, "the person sees a time-out");
      fsp.rename = realRename;
      const saved = await users.byId(user.id);
      assert.ok(!saved.password && saved.emailVerified, "the password was removed");
      const again = await verify({ token });
      assert.equal(again.j.status, "already");
      assert.equal(again.j.setPassword, true, JSON.stringify(again.j));
      assert.equal(again.j.email, "notme@example.com");
      // An account that can sign in gets no such offer.
      const fine = await users.create({ id: "usr_takeover11", email: "fine@example.com", name: "Fine", password: await hashPassword("password-1234"), emailVerified: true, createdAt: new Date().toISOString(), usage: {} });
      assert.ok(!(await verify({ token: emailToken(fine) })).j.setPassword);
    } finally {
      fsp.rename = realRename;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
