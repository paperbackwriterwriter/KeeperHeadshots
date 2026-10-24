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
const { shoots, saveMedia, readMedia, dropSelfies } = await import("../../lib/store.js");
const { setSession, knownDevice, publicUser } = await import("../../lib/auth.js");

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };

try {
  await test("a developing shoot marked at takeover keeps its selfies until it finishes, then loses them", async () => {
    const sid = "sht_takeover01";
    const file = await saveMedia(sid, Buffer.from("selfie"));
    await shoots.saveMeta({ id: sid, userId: "usr_takeover01", status: "generating", createdAt: new Date().toISOString(), selfies: [{ file }], check: { photos: [{ file }] }, dropSelfies: true });
    assert.equal(await dropSelfies(sid, { whenFinished: true }), 0, "still developing");
    assert.equal((await shoots.getMeta(sid)).selfies.length, 1);
    await shoots.updateMeta(sid, (m) => void (m.status = "done"));
    assert.equal(await dropSelfies(sid, { whenFinished: true }), 1);
    const meta = await shoots.getMeta(sid);
    assert.equal(meta.selfies.length, 0);
    assert.equal(meta.check.photos.length, 0);
    assert.ok(!meta.dropSelfies);
    assert.equal(await readMedia(file), null, "the photo itself is gone");
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
  });
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`\n${passed}/${passed} passed`);
