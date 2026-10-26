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
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
