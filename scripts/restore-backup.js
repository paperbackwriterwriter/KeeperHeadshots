// Restores records from a nightly backup (lib/backup.js).
//
// Run with the same storage settings as the site (BLOB_READ_WRITE_TOKEN for
// the main store, plus BACKUP_READ_WRITE_TOKEN if backups go to a separate
// store). Nothing is written without --apply.
//
//   node scripts/restore-backup.js                      # newest backup: what's in it
//   node scripts/restore-backup.js --backup backups/2026-10-01.json.gz
//   node scripts/restore-backup.js --only users/ --apply
//
//   --only <prefix>   only records whose key starts with this (repeatable)
//   --overwrite       also replace records that exist now (by default only
//                     missing records are restored, so nothing current is lost)
//   --missing         the default; accepted for older instructions
//   --apply           write them; without it, just list what would change
import "../lib/env.js";
import { readBackup } from "../lib/backup.js";
import { getJSON, putJSON, del } from "../lib/storage.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const values = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const only = values("--only");
const apply = flag("--apply");
const missingOnly = !flag("--overwrite");

const snap = await readBackup(values("--backup")[0] || null);
if (!snap) {
  console.error("No backup found.");
  process.exit(1);
}
const keys = Object.keys(snap.records).filter((k) => !only.length || only.some((p) => k.startsWith(p)));
console.log(`${snap.key}: taken ${snap.at}, ${snap.count} records${snap.complete ? "" : " (INCOMPLETE)"}; ${keys.length} selected`);
const byPrefix = {};
for (const k of keys) byPrefix[k.split("/")[0]] = (byPrefix[k.split("/")[0]] || 0) + 1;
console.log(byPrefix);

let written = 0;
let skipped = 0;
const rebuild = new Set();
try {
  for (const k of keys) {
    if (missingOnly && (await getJSON(k)) !== null) {
      skipped++;
      continue;
    }
    if (apply) {
      await putJSON(k, snap.records[k]);
      // A missing-only restore merges historical records into today's data.
      // Existing secondary indexes may omit those records; rebuild lazily
      // from the restored primary entries, even after a partial failure.
      const uid = k.startsWith("idx/") ? k.split("/")[1] : snap.records[k]?.userId;
      if (typeof uid === "string" && /^usr_[\w-]+$/.test(uid)) {
        if (k.startsWith("idx/") || k.startsWith("shoots/")) rebuild.add(`shoot-catalog/${uid}.json`);
        if (k.startsWith("showcase/")) rebuild.add(`showcase-users/${uid}.json`);
      }
    }
    written++;
  }
} finally {
  if (rebuild.size) await del([...rebuild]);
}
console.log(`${apply ? "Restored" : "Would restore"} ${written} records${missingOnly ? ` (${skipped} already exist, left alone)` : ""}.${apply ? "" : " Add --apply to write them."}`);
