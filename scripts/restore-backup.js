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
//   --photos          also recover unexpired photos (checksum + erasure checks)
//   --apply           write them; without it, just list what would change
import "../lib/env.js";
import { readBackup } from "../lib/backup.js";
import { restorePhoto, recordErased } from "../lib/photo-backup.js";
import { contactExpired } from "../lib/cleanup.js";
import { getJSON, putJSON, createJSON, del } from "../lib/storage.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const values = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const only = values("--only");
const apply = flag("--apply");
const missingOnly = !flag("--overwrite");

const snap = await readBackup(values("--backup")[0] || null);
if (!snap) {
  console.error("No complete backup found. Use --backup <key> to inspect a specific incomplete attempt.");
  process.exit(1);
}
const keys = Object.keys(snap.records).filter((k) => !only.length || only.some((p) => k.startsWith(p)));
const recordsOk = snap.complete && !snap.failed && !snap.photos?.failed;
const photoNote = snap.photos && (snap.photos.complete === false || snap.photos.failed) ? `; photo copies incomplete (${snap.photos.pending ?? "?"} without a copy, ${snap.photos.failed || 0} failed)` : "";
console.log(`${snap.key}: taken ${snap.at}, ${snap.count} records${recordsOk ? "" : " (INCOMPLETE OR ERRORS)"}${photoNote}; ${keys.length} selected`);
const byPrefix = {};
for (const k of keys) byPrefix[k.split("/")[0]] = (byPrefix[k.split("/")[0]] || 0) + 1;
console.log(byPrefix);

let written = 0;
let skipped = 0;
const rebuild = new Set();
try {
  for (const k of keys) {
    // Past its retention (the daily clean-up deletes these): never brought back.
    if (contactExpired(k)) { skipped++; continue; }
    if (await recordErased(k, snap.records[k])) { skipped++; continue; }
    if (missingOnly && (await getJSON(k)) !== null) {
      skipped++;
      continue;
    }
    if (apply) {
      if (missingOnly) {
        if (!await createJSON(k, snap.records[k])) { skipped++; continue; }
      } else await putJSON(k, snap.records[k]);
      if (!k.startsWith("cancelled/") && !k.startsWith("photo-erased/")) {
        try {
          if (await recordErased(k, snap.records[k])) { await del(k); skipped++; continue; }
        } catch (err) { await del(k); throw err; }
      }
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

if (flag("--photos")) {
  const counts = {};
  for (const entry of snap.photos?.entries || []) {
    if (only.length && !only.some((p) => entry.key.startsWith(p))) continue;
    const recordKey = entry.key.startsWith("media/") ? `shoots/${entry.sid}.json` : entry.key.replace(/\.jpg$/, ".json");
    const result = await restorePhoto(entry, { apply, overwrite: !missingOnly, plannedOwner: snap.records[recordKey] });
    counts[result] = (counts[result] || 0) + 1;
  }
  console.log("Photos:", counts);
} else if (snap.photos?.entries?.length) {
  console.log(`${snap.photos.entries.length} photo copies listed; add --photos to include unexpired photos.`);
}
