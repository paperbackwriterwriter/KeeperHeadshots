// Real filesystem recovery plus a private-store stand-in for outages/races.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-photo-backup-"));
process.env.DATA_DIR = root;
for (const key of ["BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "BACKUP_STORE_ID", "BACKUP_READ_WRITE_TOKEN", "STORAGE_NAMESPACE"]) delete process.env[key];
const storage = await import("../../lib/storage.js");
const { runBackup, readBackup } = await import("../../lib/backup.js");
const { restorePhoto, maintainPhotoBackups, recordErased, backupPhotos } = await import("../../lib/photo-backup.js");
const { target, mainTarget } = await import("../../lib/backup-target.js");
const { shoots, users, deleteMedia } = await import("../../lib/store.js");
const showcase = await import("../../lib/showcase.js");
const now = Date.now();
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
const fixture = async (n) => {
  const uid = `usr_${n}`, sid = `sht_${n}`;
  await storage.putJSON(`users/id/${uid}.json`, { id: uid, email: `${n}@example.com` });
  await storage.putJSON(`shoots/${sid}.json`, { id: sid, userId: uid });
  await storage.putJSON(`idx/${uid}/${sid}`, {});
  const keys = [`media/${sid}/selfie.jpg`, `media/${sid}/headshot.png`, `showcase/shc_${n}0000000000.jpg`];
  await storage.putJSON(keys[2].replace(/\.jpg$/, ".json"), { id: `shc_${n}0000000000`, userId: uid, shootId: sid, status: "pending" });
  for (const [i, key] of keys.entries()) await storage.putFile(key, Buffer.from([0, 255, 128, i, 33]), "image/jpeg");
  return { uid, sid, keys };
};
const a = await fixture("a");
let snap;
await test("selfies, headshots and shared copies have private binary manifests", async () => {
  const report = await runBackup({ now }); snap = await readBackup(report.key);
  assert.equal(report.photos, 3); assert.equal(report.failed, 0);
  assert.equal(snap.photos.entries.length, 3);
  assert.ok(snap.photos.entries.every((e) => e.bytes === 5 && /^[a-f0-9]{64}$/.test(e.sha256) && !snap.records[e.key]));
});
const entry = snap.photos.entries.find((e) => e.key === a.keys[0]);
await test("photo dry run writes nothing; restore is byte-exact and missing-only", async () => {
  const bytes = await storage.getFile(entry.key); await storage.del(entry.key);
  assert.equal(await restorePhoto(entry), "would-restore"); assert.equal(await storage.getFile(entry.key), null);
  assert.equal(await restorePhoto(entry, { apply: true }), "restored"); assert.deepEqual(await storage.getFile(entry.key), bytes);
  await storage.putFile(entry.key, Buffer.from("newer"), "image/jpeg");
  assert.equal(await restorePhoto(entry, { apply: true }), "exists"); assert.equal((await storage.getFile(entry.key)).toString(), "newer");
  assert.equal(await restorePhoto(entry, { apply: true, overwrite: true }), "restored");
});
await test("corrupt backups and path/ownership substitutions cannot be restored", async () => {
  await storage.del(entry.key); const buf = await storage.getFile(entry.backupKey);
  await storage.putFile(entry.backupKey, Buffer.from("bad"));
  await assert.rejects(restorePhoto(entry, { apply: true }), /checksum/); assert.equal(await storage.getFile(entry.key), null);
  await storage.putFile(entry.backupKey, buf);
  await assert.rejects(restorePhoto({ ...entry, key: "media/sht_other/selfie.jpg" }), /Invalid photo manifest/);
  await assert.rejects(restorePhoto({ ...entry, backupKey: "../photo.jpg" }), /Invalid photo manifest/);
  await storage.putJSON(`shoots/${a.sid}.json`, { id: a.sid, userId: "usr_other" });
  assert.equal(await restorePhoto(entry, { apply: true }), "missing-owner");
  await storage.putJSON(`shoots/${a.sid}.json`, { id: a.sid, userId: a.uid });
});
await test("CLI restores records and photos, honors dry-run and prefix selection", async () => {
  const cli = (...args) => execFileSync(process.execPath, ["scripts/restore-backup.js", "--backup", snap.key, ...args], { encoding: "utf8", env: process.env });
  await storage.del([a.keys[0], a.keys[1], `shoots/${a.sid}.json`]);
  assert.match(cli("--photos"), /would-restore/); assert.equal(await storage.getFile(a.keys[0]), null);
  cli("--photos", "--apply"); assert.ok(await storage.getFile(a.keys[0])); assert.ok(await storage.getJSON(`shoots/${a.sid}.json`));
  await storage.del(a.keys[1]); cli("--only", "showcase/", "--photos", "--apply"); assert.equal(await storage.getFile(a.keys[1]), null);
  cli("--only", "media/", "--photos", "--apply"); assert.ok(await storage.getFile(a.keys[1]));
});
await test("exclusive creation preserves a concurrent upload during recovery", async () => {
  await storage.del(entry.key); const original = mainTarget.get;
  mainTarget.get = async (key) => {
    const buf = await original(key);
    if (key === entry.backupKey) await storage.putFile(entry.key, Buffer.from("concurrent-upload"));
    return buf;
  };
  try {
    assert.equal(await restorePhoto(entry, { apply: true }), "exists");
    assert.equal((await storage.getFile(entry.key)).toString(), "concurrent-upload");
  } finally { mainTarget.get = original; }
});
await test("removing one selfie purges only its copies and forbids old recovery", async () => {
  await deleteMedia(a.keys[0].slice(6)); assert.equal(await storage.getFile(entry.backupKey), null);
  assert.equal(await restorePhoto(entry, { apply: true }), "erased");
  assert.ok(await storage.getFile(snap.photos.entries.find((e) => e.key === a.keys[1]).backupKey));
});
await test("taking down a shared headshot purges its backup and forbids record recovery", async () => {
  const shared = snap.photos.entries.find((e) => e.key.startsWith("showcase/"));
  await showcase.remove("shc_a0000000000"); assert.equal(await storage.getFile(shared.backupKey), null);
  assert.equal(await restorePhoto(shared, { apply: true }), "erased");
  assert.equal(await recordErased("showcase/shc_a0000000000.json", snap.records["showcase/shc_a0000000000.json"]), true);
});
await test("shoot deletion erases all its backups and cannot be undone by old restore", async () => {
  await shoots.remove({ id: a.sid, userId: a.uid });
  assert.deepEqual(await storage.list(`photo-backups/${a.uid}/`), []);
  assert.equal(await recordErased(`shoots/${a.sid}.json`, { userId: a.uid }), true);
  assert.equal(await restorePhoto(entry, { apply: true }), "erased");
});
await test("expiry prunes binaries even when the record backup is incomplete", async () => {
  const b = await fixture("b"); const oldNow = now - 8 * 86_400_000;
  const old = await runBackup({ now: oldNow }); const oldSnap = await readBackup(old.key);
  const oldEntry = oldSnap.photos.entries.find((e) => e.key === b.keys[0]);
  await storage.del(oldEntry.key); assert.equal(await restorePhoto(oldEntry, { apply: true, now }), "expired");
  const cleanup = await maintainPhotoBackups({ now }); assert.ok(cleanup.pruned >= 3); assert.equal(await storage.getFile(oldEntry.backupKey), null);
  const short = await runBackup({ budgetMs: 0 }); assert.equal(short.complete, false); assert.equal(short.pruned, 0);
});
await test("expiry pages through the copies and resumes where a short run stopped", async () => {
  const old = new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
  const stale = Array.from({ length: 5 }, (_, i) => `photo-backups/usr_page${i}/sht_page${i}/${"a".repeat(63)}${i}/${old}.jpg`);
  for (const k of stale) await storage.putFile(k, Buffer.from("x"));
  process.env.STORAGE_LIST_PAGE = "2";
  try {
    let budget = 0;
    const realNow = Date.now;
    // A deadline that lets exactly one page through, then runs out.
    Date.now = () => (budget++ < 6 ? realNow() : realNow() + 60_000);
    let first;
    try { first = await maintainPhotoBackups({ now, deadline: realNow() + 30_000 }); } finally { Date.now = realNow; }
    assert.equal(first.complete, false);
    const remaining = [];
    for (const k of stale) if (await storage.getFile(k)) remaining.push(k);
    assert.ok(remaining.length > 0 && remaining.length < stale.length, `remaining ${remaining.length}`);
    assert.ok((await storage.getJSON("cron/photo-maintain-main.json"))?.cursor);
    const second = await maintainPhotoBackups({ now });
    assert.equal(second.complete, true);
    for (const k of stale) assert.equal(await storage.getFile(k), null);
    assert.equal((await storage.getJSON("cron/photo-maintain-main.json"))?.cursor, null);
  } finally { delete process.env.STORAGE_LIST_PAGE; }
});
// Test the actual shared target interface; no SDK auth is needed by the stand-in.
const originals = Object.fromEntries(["get", "put", "list", "listPage", "del"].map((k) => [k, target[k]]));
const remote = new Map(); let offline = false, interceptPut = null, interceptGet = null;
process.env.BACKUP_READ_WRITE_TOKEN = "private-test-store";
target.put = async (k, v) => { if (offline) throw new Error("store offline"); if (interceptPut) await interceptPut(k); remote.set(k, Buffer.from(v)); };
target.get = async (k) => { if (offline) throw new Error("store offline"); if (interceptGet) await interceptGet(k); return remote.get(k) || null; };
target.list = async (p) => { if (offline) throw new Error("store offline"); return [...remote.keys()].filter((k) => k.startsWith(p)); };
target.del = async (keys) => { if (offline) throw new Error("store offline"); keys.forEach((k) => remote.delete(k)); };
target.listPage = async (p, cursor) => { const keys = (await target.list(p)).sort().filter((k) => !cursor || k > cursor); return { keys, cursor: null }; };
try {
  const c = await fixture("c"); let remoteSnap;
  await test("separate private store holds both records and photo bytes", async () => {
    const report = await runBackup({ now }); assert.equal(report.separateStore, true); remoteSnap = await readBackup(report.key);
    assert.ok(remoteSnap.photos.entries.filter((e) => e.uid === c.uid).every((e) => e.store === "separate" && remote.has(e.backupKey)));
  });
  const ce = remoteSnap.photos.entries.find((e) => e.key === c.keys[0]);
  await test("backup store outage falls back and the newest fallback snapshot is readable", async () => {
    offline = true; const r = await runBackup({ now: now + 86_400_000 });
    assert.equal(r.separateStore, false); assert.ok(r.failed); const fallback = await readBackup(r.key);
    assert.equal(fallback.key, r.key); assert.ok(fallback.photos.entries.every((e) => e.store === "main")); offline = false;
    assert.equal((await readBackup()).key, remoteSnap.key);
  });
  await test("erasure during remote upload removes the late backup instead of attaching it", async () => {
    const d = await fixture("d"); let triggered = false;
    interceptPut = async (key) => { if (!triggered && key.startsWith(`photo-backups/${d.uid}/`)) { triggered = true; await shoots.remove({ id: d.sid, userId: d.uid }); } };
    const report = await runBackup({ now }); interceptPut = null;
    assert.ok(triggered); assert.ok(![...remote.keys()].some((k) => k.startsWith(`photo-backups/${d.uid}/`)));
    assert.ok(!(await readBackup(report.key)).photos.entries.some((e) => e.uid === d.uid));
  });
  await test("outage deletion leaves a durable purge, denies recovery, then retries", async () => {
    offline = true; await users.remove({ id: c.uid, email: "c@example.com" });
    assert.ok((await storage.list("photo-purge/")).length); assert.ok(remote.has(ce.backupKey));
    assert.equal(await restorePhoto(ce, { apply: true }), "erased");
    offline = false; await maintainPhotoBackups({ now }); assert.equal(remote.has(ce.backupKey), false);
    assert.equal((await storage.list("photo-purge/")).length, 0);
  });
  await test("mirrored erasure still blocks recovery after loss of main-store markers", async () => {
    await storage.del(await storage.list("photo-erased/")); await storage.del(await storage.list("cancelled/"));
    await storage.putJSON(`shoots/${c.sid}.json`, { id: c.sid, userId: c.uid });
    assert.equal(await restorePhoto(ce, { apply: true }), "erased");
    assert.equal(await recordErased(`users/id/${c.uid}.json`, { id: c.uid }), true);
  });
  await test("restoration fails closed if remote erasure checks are unavailable", async () => {
    offline = true; await assert.rejects(restorePhoto(ce, { apply: true }), /offline/); offline = false;
  });
  await test("deletion between reading a backup and writing recovery blocks the write", async () => {
    const f = await fixture("f"); const r = await runBackup({ now }); const fe = (await readBackup(r.key)).photos.entries.find((e) => e.key === f.keys[0]);
    await storage.del(fe.key); let ran = false;
    interceptGet = async (key) => { if (key === fe.backupKey && !ran) { ran = true; await shoots.remove({ id: f.sid, userId: f.uid }); } };
    assert.ok(["missing-backup", "erased"].includes(await restorePhoto(fe, { apply: true }))); interceptGet = null;
    assert.ok(ran); assert.equal(await storage.getFile(fe.key), null);
  });
  await test("an erasure-check outage after recovery removes the just-written image", async () => {
    const h = await fixture("h"); const r = await runBackup({ now }); const he = (await readBackup(r.key)).photos.entries.find((e) => e.key === h.keys[0]);
    await storage.del(he.key);
    interceptGet = async (key) => { if (key.startsWith("photo-erased/") && await storage.getFile(he.key)) throw new Error("post-write-check-offline"); };
    try { await assert.rejects(restorePhoto(he, { apply: true }), /post-write-check-offline/); }
    finally { interceptGet = null; }
    assert.equal(await storage.getFile(he.key), null);
  });
  await test("short photo runs resume after the last batch instead of starving later files", async () => {
    const g = await fixture("g"); let writes = 0;
    // The first batch of copies runs past the deadline, however long the
    // set-up before it took on a busy machine.
    let deadline = 0;
    interceptPut = async (key) => { if (key.startsWith("photo-backups/")) { writes++; await new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now() + 1))); } };
    const records = {}; for (const key of await storage.list("shoots/")) records[key] = await storage.getJSON(key);
    deadline = Date.now() + 2000;
    const first = await backupPhotos({ records, now, deadline });
    const cursor = (await storage.getJSON("cron/photo-backup-state.json"))?.cursor;
    interceptPut = null; assert.ok(!first.passComplete && cursor && writes);
    const second = await backupPhotos({ records, now, deadline: Date.now() + 10_000 });
    assert.equal(second.complete, true); assert.equal(await storage.getJSON("cron/photo-backup-state.json"), null);
    assert.ok(second.entries.some((e) => e.uid === g.uid));
  });
  await test("a day's worth of expired copies is pruned in batches, well inside the time budget", async () => {
    const oldDay = new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
    const many = Array.from({ length: 250 }, (_, i) => `photo-backups/usr_bulk${i}/sht_bulk${i}/${"b".repeat(60)}${String(i).padStart(4, "0")}/${oldDay}.jpg`);
    for (const k of many) remote.set(k, Buffer.from("x"));
    const realDel = target.del; let calls = 0;
    target.del = async (keys) => { calls++; return realDel(keys); };
    let out;
    try { out = await maintainPhotoBackups({ now }); } finally { target.del = realDel; }
    assert.equal(out.complete, true);
    assert.ok(many.every((k) => !remote.has(k)));
    assert.ok(calls <= 4, `${calls} delete calls`);
  });
  await test("a temporary storage error on one photo is tried again, not counted as a failed backup", async () => {
    await fixture("r");
    let failed = 0;
    interceptPut = async (key) => { if (key.startsWith("photo-backups/") && key.includes("usr_r/") && failed++ === 0) throw new Error("Vercel Blob: Failed to fetch blob: 500 Internal Server Error"); };
    const records = {}; for (const key of await storage.list("shoots/")) records[key] = await storage.getJSON(key);
    let out;
    try { out = await backupPhotos({ records, now, deadline: Date.now() + 20_000 }); }
    finally { interceptPut = null; }
    assert.equal(failed > 1, true);
    assert.equal(out.failed, 0, JSON.stringify(out.failed));
    assert.ok(out.entries.some((e) => e.uid === "usr_r"));
  });
  await test("time-limited nights accumulate photo copies into a full recovery point with the newest records", async () => {
    const h = await fixture("k");
    await storage.putJSON(`users/id/${h.uid}.json`, { id: h.uid, email: "k@example.com", note: "v1" });
    interceptPut = async (key) => { if (key.startsWith("photo-backups/")) await new Promise((r) => setTimeout(r, 15)); };
    let last; const runs = [];
    try {
      for (let i = 0; i < 40; i++) {
        await storage.putJSON(`users/id/${h.uid}.json`, { id: h.uid, email: "k@example.com", note: `v${i + 2}` });
        last = await runBackup({ now, budgetMs: 60 }); runs.push(last);
        if (last.photosPending === 0) break;
      }
    } finally { interceptPut = null; }
    assert.ok(runs.length > 1 && runs.slice(0, -1).some((r) => r.photosPending > 0), "needed several short runs");
    assert.equal(last.photosPending, 0);
    assert.ok(runs.every((r) => r.successful), "every short night is a record recovery point");
    const snap = await readBackup();
    assert.equal(snap.key, last.key);
    assert.equal(snap.records[`users/id/${h.uid}.json`].note, `v${runs.length + 1}`, "restore picks the newest records");
    assert.equal(snap.photos.complete, true);
    assert.ok(h.keys.every((k) => snap.photos.entries.some((e) => e.key === k)), "the manifest covers every photo");
  });
  await test("a run that times out reading records keeps the accumulated photo copies", async () => {
    const before = (await readBackup()).photos.entries.map((e) => e.key).sort();
    assert.ok(before.length >= 3);
    const failed = await runBackup({ now, budgetMs: 0 }); // no records read at all
    assert.equal(failed.successful, false);
    const kept = (await readBackup(failed.key)).photos.entries.map((e) => e.key).sort();
    assert.deepEqual(kept, before, "the failed run's manifest still lists every earlier copy");
    // And the next, partial run still offers every photo for recovery.
    interceptPut = async (key) => { if (key.startsWith("photo-backups/")) await new Promise((r) => setTimeout(r, 15)); };
    let next;
    try { next = await runBackup({ now, budgetMs: 60 }); } finally { interceptPut = null; }
    const offered = new Set((await readBackup(next.key)).photos.entries.map((e) => e.key));
    assert.ok(before.every((k) => offered.has(k)), `${offered.size} of ${before.length} offered`);
  });
} finally { Object.assign(target, originals); delete process.env.BACKUP_READ_WRITE_TOKEN; }
await test("preview namespace keeps recovery copies and erasures apart from production", async () => {
  const code = `const s=await import('./lib/storage.js'); const b=await import('./lib/backup.js'); await s.putJSON('shoots/sht_preview.json',{id:'sht_preview',userId:'usr_preview'}); await s.putFile('media/sht_preview/p.jpg',Buffer.from('p')); const r=await b.runBackup(); console.log(r.photos);`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, STORAGE_NAMESPACE: "preview/", BACKUP_STORE_ID: "unreachable" } });
  assert.match(out, /1/); assert.equal(await storage.getJSON("shoots/sht_preview.json"), null);
  assert.ok((await fs.readdir(path.join(root, "preview/photo-backups/usr_preview/sht_preview"))).length);
});
await fs.rm(root, { recursive: true, force: true });
console.log(`\n${passed}/${passed} passed`);
