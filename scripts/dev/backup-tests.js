// DEV/QA ONLY — the nightly backup (lib/backup.js) and restore
// (scripts/restore-backup.js) against a throwaway local store.
//   node scripts/dev/backup-tests.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-backup-"));
process.env.DATA_DIR = dir;
for (const k of ["BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "BACKUP_READ_WRITE_TOKEN"]) delete process.env[k];
const storage = await import("../../lib/storage.js");
const { runBackup, readBackup, KEEP_DAYS } = await import("../../lib/backup.js");

const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));

await storage.putJSON("users/id/usr_a.json", { id: "usr_a", email: "a@x.com", credits: 3 });
await storage.putJSON("users/email/a@x.com.json", { id: "usr_a" });
await storage.putJSON("payments/cs_1.json", { sessionId: "cs_1", amount: 2900 });
await storage.putJSON("shoots/sht_1.json", { id: "sht_1", userId: "usr_a" });
await storage.putJSON("shots/sht_1/shot_1.json", { id: "shot_1", status: "done" });
await storage.putJSON("stats/days/2026-09-28.json", { signup: 1 });
await storage.putJSON("ratelimit/contact/abc/2026-09-28T10.json", { n: 1 });
await storage.putFile("media/sht_1/p.jpg", Buffer.from("jpeg"), "image/jpeg");

const r = await runBackup();
const snap = await readBackup();
const keys = Object.keys(snap.records);
ok("backup holds accounts, payments, shoots, frames and funnel counts", ["users/id/usr_a.json", "users/email/a@x.com.json", "payments/cs_1.json", "shoots/sht_1.json", "shots/sht_1/shot_1.json", "stats/days/2026-09-28.json"].every((k) => keys.includes(k)) && snap.records["users/id/usr_a.json"].credits === 3, JSON.stringify(r));
ok("backup leaves out photos and rate-limit counters", !keys.some((k) => k.startsWith("media/") || k.startsWith("ratelimit/")) && snap.complete === true);

// Only the newest KEEP_DAYS snapshots are kept.
for (let i = 1; i <= KEEP_DAYS + 5; i++) await storage.putFile(`backups/2025-01-${String(i).padStart(2, "0")}.json.gz`, Buffer.from("old"), "application/gzip");
await runBackup();
const left = (await storage.list("backups/")).filter((k) => k.endsWith(".json.gz"));
ok(`keeps the newest ${KEEP_DAYS}`, left.length === KEEP_DAYS && left.includes(r.key), `${left.length} kept`);

// Restore: a deleted account comes back; an existing record isn't overwritten with --missing.
await storage.del(["users/id/usr_a.json"]);
await storage.putJSON("payments/cs_1.json", { sessionId: "cs_1", amount: 2900, note: "newer" });
const run = (...a) => execFileSync(process.execPath, ["scripts/restore-backup.js", ...a], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
const dry = run("--missing");
const stillGone = (await storage.getJSON("users/id/usr_a.json")) === null;
const out = run("--missing", "--apply");
const restored = await storage.getJSON("users/id/usr_a.json");
const kept = await storage.getJSON("payments/cs_1.json");
ok("dry run writes nothing", stillGone && /Would restore 1 records/.test(dry), dry.trim().split("\n").pop());
ok("restore brings back a deleted account, leaves newer records alone", restored?.credits === 3 && kept.note === "newer" && /Restored 1 records/.test(out), out.trim().split("\n").pop());

fs.rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
