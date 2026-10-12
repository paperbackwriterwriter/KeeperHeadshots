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
await storage.putJSON("cancelled/shoots/sht_gone.json", { cancelled: true });
await storage.putJSON("jobs/shoots/sht_1/job_1.json", { sid: "sht_1", jobId: "job_1" });
await storage.putJSON("payments/cs_1.json", { sessionId: "cs_1", amount: 2900 });
await storage.putJSON("shoots/sht_1.json", { id: "sht_1", userId: "usr_a" });
await storage.putJSON("idx/usr_a/sht_1", { createdAt: "2026-09-28T00:00:00Z" });
await storage.putJSON("shoot-catalog/usr_a.json", { items: [{ id: "sht_1", createdAt: "2026-09-28T00:00:00Z" }] });
await storage.putJSON("showcase-users/usr_a.json", { ids: ["shc_1"] });
await storage.putJSON("billing-sync/usr_a.json", { historyCursor: "cs_1", leaseUntil: 0, nextAutoAt: 0 });
await storage.putJSON("showcase/shc_1.json", { id: "shc_1", userId: "usr_a", status: "pending" });
await storage.putFile("showcase/shc_1.jpg", Buffer.from("jpg"), "image/jpeg");
await storage.putJSON("stats/seen/usr_a/signup.json", { at: "2026-09-28T00:00:00Z" });
await storage.putJSON("shots/sht_1/shot_1.json", { id: "shot_1", status: "done" });
await storage.putJSON("stats/days/2026-09-28.json", { signup: 1 });
await storage.putJSON("ratelimit/contact/abc/2026-09-28T10.json", { n: 1 });
await storage.putFile("media/sht_1/p.jpg", Buffer.from("jpeg"), "image/jpeg");

const r = await runBackup();
const snap = await readBackup();
const keys = Object.keys(snap.records);
ok("backup holds accounts, their shoot index, payments, shoots, frames and funnel counts", ["users/id/usr_a.json", "users/email/a@x.com.json", "payments/cs_1.json", "shoots/sht_1.json", "shots/sht_1/shot_1.json", "idx/usr_a/sht_1", "stats/days/2026-09-28.json"].every((k) => keys.includes(k)) && snap.records["users/id/usr_a.json"].credits === 3, JSON.stringify(r));
ok("backup preserves erasure barriers and durable job intents", snap.records["cancelled/shoots/sht_gone.json"]?.cancelled === true && snap.records["jobs/shoots/sht_1/job_1.json"]?.jobId === "job_1");
ok("record JSON omits binary payloads and rate-limit counters", !keys.some((k) => k.startsWith("media/") || k.startsWith("ratelimit/")) && snap.complete === true);
ok("backup includes history catalogs, showcase indexes and reconciliation cursors", ["shoot-catalog/usr_a.json", "showcase-users/usr_a.json", "billing-sync/usr_a.json"].every((k) => keys.includes(k)));
ok("record JSON holds showcase metadata and funnel markers separately from binaries", keys.includes("showcase/shc_1.json") && !keys.includes("showcase/shc_1.jpg") && keys.includes("stats/seen/usr_a/signup.json"));
{
  // Deleting a shoot takes its develop claim with it (lib/store.js).
  const { shoots } = await import("../../lib/store.js");
  await storage.putJSON("shoots/sht_2.json", { id: "sht_2", userId: "usr_a" });
  await storage.putJSON("idx/usr_a/sht_2", { createdAt: "2026-09-28T00:00:00Z" });
  await storage.putJSON("claims/develop/sht_2.json", { userId: "usr_a" });
  await shoots.remove({ id: "sht_2", userId: "usr_a" });
  ok("deleting a shoot removes its develop claim", !(await storage.getJSON("claims/develop/sht_2.json")) && !(await storage.getJSON("shoots/sht_2.json")));
}

// Only the newest KEEP_DAYS snapshots are kept.
for (let i = 1; i <= KEEP_DAYS + 5; i++) await storage.putFile(`backups/2025-01-${String(i).padStart(2, "0")}.json.gz`, Buffer.from("old"), "application/gzip");
await runBackup();
const left = (await storage.list("backups/")).filter((k) => k.endsWith(".json.gz"));
ok(`keeps the newest ${KEEP_DAYS}`, left.length === KEEP_DAYS && left.includes(r.key), `${left.length} kept`);
for (let i = 1; i <= 3; i++) await storage.putFile(`backups/2024-12-${String(i).padStart(2, "0")}.json.gz`, Buffer.from("old"), "application/gzip");
const short = await runBackup({ budgetMs: 0, now: Date.parse("2024-11-30T12:00:00Z") });
const leftAfterShort = (await storage.list("backups/")).filter((k) => k.endsWith(".json.gz"));
ok("an incomplete backup prunes nothing, so the last complete one stays", short.complete === false && short.pruned === 0 && leftAfterShort.length === KEEP_DAYS + 4, `complete=${short.complete} pruned=${short.pruned} left=${leftAfterShort.length}`);
await storage.del(leftAfterShort.filter((k) => k.includes("2024-1")));

// Restore: a deleted account comes back; an existing record isn't overwritten with --missing.
await storage.del(["users/id/usr_a.json"]);
await storage.putJSON("payments/cs_1.json", { sessionId: "cs_1", amount: 2900, note: "newer" });
const run = (...a) => execFileSync(process.execPath, ["scripts/restore-backup.js", ...a], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
const dry = run();
const stillGone = (await storage.getJSON("users/id/usr_a.json")) === null;
const out = run("--apply");
const restored = await storage.getJSON("users/id/usr_a.json");
const kept = await storage.getJSON("payments/cs_1.json");
ok("dry run writes nothing", stillGone && /Would restore 1 records/.test(dry), dry.trim().split("\n").pop());
ok("restore brings back a deleted account, and by default leaves current records alone", restored?.credits === 3 && kept.note === "newer" && /Restored 1 records/.test(out), out.trim().split("\n").pop());
const over = run("--only", "payments/", "--overwrite", "--apply");
ok("--overwrite replaces current records when asked", (await storage.getJSON("payments/cs_1.json")).note !== "newer" && /Restored/.test(over), over.trim().split("\n").pop());

// Today's indexes may have removed an entry recovered from an older snapshot.
await storage.putJSON("shoot-catalog/usr_a.json", { items: [] });
await storage.putJSON("showcase-users/usr_a.json", { ids: [] });
await storage.del(["shoots/sht_1.json", "showcase/shc_1.json"]);
run("--only", "shoots/", "--only", "showcase/", "--apply");
const invalidated = !(await storage.getJSON("shoot-catalog/usr_a.json")) && !(await storage.getJSON("showcase-users/usr_a.json"));
const { listShootPage } = await import("../../lib/shoot-list.js");
ok("restored records rebuild current indexes so recovered shoots are visible", invalidated && (await listShootPage("usr_a")).shoots.some((s) => s.id === "sht_1") && (await storage.getJSON("showcase/shc_1.json"))?.userId === "usr_a");

// A backup store that can't be reached (store id set, no OIDC token here):
// tonight's copy still lands in the main store, and it's reported.
process.env.BACKUP_STORE_ID = "store_unreachable";
delete process.env.VERCEL_OIDC_TOKEN;
const errors = [];
const origError = console.error;
console.error = (...a) => errors.push(a.join(" "));
const fb = await runBackup().catch((err) => ({ threw: err.message }));
console.error = origError;
delete process.env.BACKUP_STORE_ID;
ok("unreachable backup store falls back to the main store, with an alert", fb.separateStore === false && !!(await storage.getFile(fb.key)) && errors.some((e) => /backup store unavailable/.test(e)), JSON.stringify(fb));

fs.rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
