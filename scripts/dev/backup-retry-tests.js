// Recovery points must survive same-day failures, concurrency and store fallback.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-backup-retry-"));
process.env.DATA_DIR = root;
for (const key of ["BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "BACKUP_STORE_ID", "BACKUP_READ_WRITE_TOKEN", "STORAGE_NAMESPACE"]) delete process.env[key];
const storage = await import("../../lib/storage.js");
const { runBackup, readBackup } = await import("../../lib/backup.js");
const { restorePhoto, maintainPhotoBackups } = await import("../../lib/photo-backup.js");
const { target } = await import("../../lib/backup-target.js");
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
const now = Date.now();
const media = "media/sht_retry/photo.jpg";
await storage.putJSON("users/id/usr_retry.json", { id: "usr_retry" });
await storage.putJSON("shoots/sht_retry.json", { id: "sht_retry", userId: "usr_retry" });
await storage.putFile(media, Buffer.from("first-photo"));
const first = await runBackup({ now });
const saved = await storage.getFile(first.key);
const original = await readBackup();
let retry;
await test("an exhausted retry preserves the complete daily snapshot byte for byte", async () => {
  retry = await runBackup({ now, budgetMs: 0 });
  assert.equal(retry.successful, false); assert.notEqual(retry.key, first.key);
  assert.match(retry.key, /^backups\/incomplete\//); assert.equal(retry.pruned, 0);
  assert.deepEqual(await storage.getFile(first.key), saved);
  assert.equal((await readBackup()).key, first.key);
  assert.equal((await readBackup(retry.key)).complete, false);
});
await test("repeated incomplete attempts with the same timestamp have distinct keys", async () => {
  const again = await runBackup({ now, budgetMs: 0 });
  assert.notEqual(again.key, retry.key); assert.ok(await storage.getFile(retry.key));
  assert.ok(await storage.getFile(again.key));
});
await test("a failed read cannot overwrite an earlier manifest or its image bytes", async () => {
  await storage.putFile("users/id/usr_broken.json", Buffer.from("{invalid"));
  await storage.putFile(media, Buffer.from("later-photo"));
  const bad = await runBackup({ now }); const partial = await readBackup(bad.key);
  assert.ok(bad.failed); assert.equal(bad.successful, false);
  assert.deepEqual(await storage.getFile(first.key), saved);
  assert.notEqual(partial.photos.entries[0].backupKey, original.photos.entries[0].backupKey);
  assert.equal((await storage.getFile(original.photos.entries[0].backupKey)).toString(), "first-photo");
  await storage.del(media);
  assert.equal(await restorePhoto(original.photos.entries[0], { apply: true }), "restored");
  assert.equal((await storage.getFile(media)).toString(), "first-photo");
  await storage.del("users/id/usr_broken.json");
});
await test("overlapping successful and incomplete runs leave a complete recovery point", async () => {
  await Promise.all([runBackup({ now }), runBackup({ now, budgetMs: 0 })]);
  const snap = await readBackup(); assert.equal(snap.complete, true); assert.equal(snap.failed, 0);
  assert.equal(await restorePhoto(snap.photos.entries[0]), "exists");
});
await test("legacy incomplete/error snapshots are skipped by default but explicitly readable", async () => {
  const future = `backups/${new Date(now + 86_400_000).toISOString().slice(0, 10)}.json.gz`;
  const old = { version: 1, at: new Date(now + 86_400_000).toISOString(), complete: false, count: 0, records: {} };
  await storage.putFile(future, zlib.gzipSync(JSON.stringify(old)));
  assert.equal((await readBackup()).key, first.key); assert.equal((await readBackup(future)).count, 0);
  old.complete = true; old.failed = 1;
  await storage.putFile(future, zlib.gzipSync(JSON.stringify(old)));
  assert.equal((await readBackup()).key, first.key); await storage.del(future);
});
await test("a corrupt newest snapshot falls back to the latest readable complete one", async () => {
  const future = `backups/${new Date(now + 86_400_000).toISOString().slice(0, 10)}.json.gz`;
  await storage.putFile(future, Buffer.from("broken-gzip"));
  assert.equal((await readBackup()).key, first.key); await storage.del(future);
});
await test("default CLI recovery selects the complete point, while explicit attempts warn", async () => {
  const cli = (...args) => execFileSync(process.execPath, ["scripts/restore-backup.js", ...args], { encoding: "utf8", env: process.env });
  assert.ok(cli().startsWith(first.key));
  assert.match(cli("--backup", retry.key), /INCOMPLETE OR ERRORS/);
});
await test("incomplete attempts expire without deleting successful recovery points", async () => {
  const old = "backups/incomplete/2000-01-01/00-00-00.000Z-0123456789abcdef.json.gz";
  await storage.putFile(old, Buffer.from("old"));
  const r = await runBackup({ now, budgetMs: 0 });
  assert.equal(await storage.getFile(old), null); assert.ok(r.incompletePruned);
  assert.ok(await storage.getFile(first.key)); assert.equal(r.pruned, 0);
});
const originals = Object.fromEntries(["get", "put", "list", "del"].map((k) => [k, target[k]]));
const remote = new Map(); let offline = false;
process.env.BACKUP_READ_WRITE_TOKEN = "private-test-store";
target.put = async (k, v) => { if (offline) throw new Error("offline"); remote.set(k, Buffer.from(v)); };
target.get = async (k) => { if (offline) throw new Error("offline"); return remote.get(k) || null; };
target.list = async (p) => { if (offline) throw new Error("offline"); return [...remote.keys()].filter((k) => k.startsWith(p)); };
target.del = async (keys) => { if (offline) throw new Error("offline"); keys.forEach((k) => remote.delete(k)); };
try {
  await test("expiry removes fallback attempts from both stores after the remote store recovers", async () => {
    const old = "backups/incomplete/2000-01-01/00-00-00.000Z-0123456789abcdef.json.gz";
    await storage.putFile(old, Buffer.from("old-primary")); remote.set(old, Buffer.from("old-remote"));
    const r = await runBackup({ now });
    assert.equal(await storage.getFile(old), null); assert.equal(remote.has(old), false);
    assert.equal(r.incompletePruned, 2);
  });
  await test("same-day complete copies are selected by capture time across stores", async () => {
    const base = { version: 2, count: 1, complete: true, failed: 0, records: {}, photos: { complete: true, failed: 0, entries: [] } };
    remote.set(first.key, zlib.gzipSync(JSON.stringify({ ...base, at: new Date(now - 1000).toISOString(), records: { "users/id/usr_retry.json": { id: "usr_retry", value: "remote-old" } } })));
    await storage.putFile(first.key, zlib.gzipSync(JSON.stringify({ ...base, at: new Date(now).toISOString(), records: { "users/id/usr_retry.json": { id: "usr_retry", value: "main-new" } } })));
    assert.equal((await readBackup()).records["users/id/usr_retry.json"].value, "main-new");
    assert.equal((await readBackup(first.key)).records["users/id/usr_retry.json"].value, "main-new");
  });
  await test("an unavailable dedicated store never destroys the previous successful backup", async () => {
    const previous = await storage.getFile(first.key); offline = true;
    const r = await runBackup({ now }); assert.equal(r.separateStore, false); assert.equal(r.successful, false);
    assert.deepEqual(await storage.getFile(first.key), previous);
    assert.equal((await readBackup()).key, first.key);
    assert.ok(await readBackup(r.key)); offline = false;
  });
  await test("old daily photo paths still support recovery and expiry", async () => {
    const e = original.photos.entries[0];
    const legacy = e.backupKey.replace(/-[a-f0-9]{16}(?=\.jpg$)/, "");
    await storage.putFile(legacy, Buffer.from("first-photo")); await storage.del(media);
    assert.equal(await restorePhoto({ ...e, backupKey: legacy }, { apply: true }), "restored");
    await maintainPhotoBackups({ now: now + 8 * 86_400_000 });
    assert.equal(await storage.getFile(legacy), null);
  });
} finally { Object.assign(target, originals); delete process.env.BACKUP_READ_WRITE_TOKEN; }
await fs.rm(root, { recursive: true, force: true });
console.log(`\n${passed}/${passed} passed`);
