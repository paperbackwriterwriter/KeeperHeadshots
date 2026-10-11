// Nightly backup of every record the business runs on: accounts and their
// shoot index, payments, refunds, free-shoot and develop claims, usage, shoots
// and their frame records, teams and invites, contact messages and the funnel
// counts. It's one gzipped JSON
// snapshot a day, backups/<YYYY-MM-DD>.json.gz, and the last KEEP_DAYS
// days are kept.
//
// Where it goes: a second, private Vercel Blob store connected to the project
// with the env prefix BACKUP (BACKUP_STORE_ID, signed in with the project's
// Vercel OIDC token; or an older-style BACKUP_READ_WRITE_TOKEN), so a problem
// with the main store doesn't take the backups with it. Without one, the main
// store, which still covers mistakes and bad writes but not losing the store.
//
// Private binary photo copies expire after seven days. The snapshot carries
// their manifest; photo deletion and restore guards live in photo-backup.js.

import zlib from "node:zlib";
import { target, mainTarget, usesSeparate } from "./backup-target.js";
import { backupPhotos } from "./photo-backup.js";
export { target } from "./backup-target.js";
import { list, getJSON, putFile, del } from "./storage.js";

export const PREFIXES = ["users/", "idx/", "shoot-catalog/", "showcase-users/", "billing-sync/", "cancelled/", "photo-erased/", "jobs/", "payments/", "refunds/", "claims/", "usage/", "shoots/", "shots/", "teams/", "invites/", "contact/", "showcase/", "stats/days/", "stats/seen/"];
export const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const PARALLEL = 16;

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export async function runBackup({ now = Date.now(), budgetMs = 240_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const keys = (await Promise.all(PREFIXES.map((p) => list(p)))).flat().filter((k) => k.endsWith(".json") || k.startsWith("idx/")); // index entries have no extension
  const records = {};
  let failed = 0;
  let complete = true;
  for (let i = 0; i < keys.length; i += PARALLEL) {
    if (Date.now() >= deadline) {
      complete = false;
      break;
    }
    await Promise.all(
      keys.slice(i, i + PARALLEL).map(async (k) => {
        try {
          const v = await getJSON(k);
          if (v !== null) records[k] = v;
        } catch (err) {
          failed++;
          console.warn("[backup] couldn't read", k, err.message);
        }
      }),
    );
  }
  const photos = await backupPhotos({ records, now, deadline });
  complete = complete && photos.complete;
  failed += photos.failed;
  const snapshot = { version: 2, photos, failed, at: new Date(now).toISOString(), complete, count: Object.keys(records).length, records };
  const buf = zlib.gzipSync(JSON.stringify(snapshot));
  const key = `backups/${dayOf(now)}.json.gz`;
  // A namespaced copy (a preview deployment) keeps its backups in its own
  // part of the main store: the backup store holds the live site's only.
  let separateStore = usesSeparate();
  try {
    if (!separateStore) await putFile(key, buf, "application/gzip");
    else await target.put(key, buf);
  } catch (err) {
    if (!separateStore) throw err;
    // The backup store couldn't be reached: keep tonight's copy in the main
    // store rather than none, and say so (this reaches the alert email).
    console.error("[backup] backup store unavailable, saved to the main store instead:", err.message);
    await putFile(key, buf, "application/gzip");
    separateStore = false;
  }

  // Keep the newest KEEP_DAYS snapshots. Nothing is pruned after an incomplete
  // one, so a run of short nights can't age out the last complete snapshot.
  const store = separateStore ? target : { list, del };
  const all = (await store.list("backups/")).filter((k) => /^backups\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(k)).sort();
  const old = complete && !failed ? all.slice(0, Math.max(0, all.length - KEEP_DAYS)) : [];
  if (old.length) await store.del(old);

  const report = { key, records: snapshot.count, listed: keys.length, failed, complete, bytes: buf.length, separateStore, photos: photos.entries.length, photoBytes: photos.bytes, photosPruned: photos.pruned, pruned: old.length };
  // An incomplete or partly failed backup is an error, so it reaches the alert email.
  if (!complete || failed) console.error("[backup] incomplete", JSON.stringify(report));
  return report;
}

// Reads a snapshot (a key in the backup store, or the newest one).
export async function readBackup(key = null) {
  const stores = usesSeparate() ? [target, mainTarget] : [mainTarget];
  let failure;
  const candidates = [];
  for (const store of stores) {
    try {
      const names = key ? [key] : (await store.list("backups/")).filter((k) => /^backups\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(k));
      for (const name of names) candidates.push({ name, store });
    } catch (err) { failure = err; }
  }
  candidates.sort((a, b) => b.name.localeCompare(a.name));
  for (const { name, store } of candidates) {
    try {
      const buf = await store.get(name);
      if (buf) return { key: name, ...JSON.parse(zlib.gunzipSync(buf).toString("utf8")) };
    } catch (err) { failure = err; }
  }
  if (failure) throw failure;
  return null;
}
