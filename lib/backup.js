// Nightly backup of every record the business runs on: accounts and their
// shoot index, payments, refunds, free-shoot and develop claims, usage, shoots
// and their frame records, teams and invites, contact messages and the funnel
// counts. It's one gzipped JSON
// snapshot a day, backups/<YYYY-MM-DD>.json.gz, kept for KEEP_DAYS days
// (expireBackups).
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
import crypto from "node:crypto";
import { target, mainTarget, usesSeparate, backupTargets } from "./backup-target.js";
import { backupPhotos } from "./photo-backup.js";
export { target } from "./backup-target.js";
import { list, getJSON, putFile, del } from "./storage.js";

export const PREFIXES = ["users/", "idx/", "shoot-catalog/", "showcase-users/", "billing-sync/", "cancelled/", "photo-erased/", "jobs/", "payments/", "refunds/", "claims/", "usage/", "shoots/", "shots/", "teams/", "invites/", "contact/", "showcase/", "stats/days/", "stats/seen/"];
// The privacy policy promises at most 30 days, so a longer setting is capped.
export const MAX_KEEP_DAYS = 30;
const configuredDays = Number(process.env.BACKUP_KEEP_DAYS || MAX_KEEP_DAYS);
export const KEEP_DAYS = Number.isFinite(configuredDays) && configuredDays >= 1 ? Math.min(MAX_KEEP_DAYS, Math.floor(configuredDays)) : MAX_KEEP_DAYS;
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
  const attempt = crypto.randomBytes(8).toString("hex");
  const photos = await backupPhotos({ records, now, deadline, attempt, recordsComplete: complete && failed === 0 });
  // The records are the recovery point: every record read, none failed, and no
  // photo copy or store failure. Photos merely not reached before the deadline
  // don't count against it (photos.complete, photos.pending): a busy night that
  // copies only some photos still leaves a full record recovery point, and its
  // manifest carries earlier copies forward (photo-backup.js).
  const snapshot = { version: 3, photos, failed, at: new Date(now).toISOString(), complete, count: Object.keys(records).length, records };
  const buf = zlib.gzipSync(JSON.stringify(snapshot));
  // An incomplete retry must never replace a complete daily recovery point.
  // Photo copies also carry this attempt ID, so a late/failed run cannot
  // overwrite bytes referenced by a previously successful manifest.
  const successful = complete && failed === 0 && !photos.failed;
  const key = successful ? `backups/${dayOf(now)}.json.gz` : `backups/incomplete/${dayOf(now)}/${new Date(now).toISOString().slice(11).replace(/:/g, "-")}-${attempt}.json.gz`;
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

  const expiry = await expireBackups({ now });
  const photosDone = photos.complete && !photos.failed;
  const report = { key, records: snapshot.count, listed: keys.length, failed: failed + photos.failed, complete: complete && photos.complete, successful, photosPending: photos.pending, bytes: buf.length, separateStore, photos: photos.entries.length, photoBytes: photos.bytes, photosPruned: photos.pruned, pruned: expiry.pruned, incompletePruned: expiry.incompletePruned, cleanupFailed: expiry.failed, newestComplete: expiry.newest };
  // An incomplete or partly failed backup, records or photos, is an error, so
  // it reaches the alert email.
  if (!successful || !photosDone) console.error("[backup] incomplete", JSON.stringify(report));
  return report;
}

// Retention is by age, in every store that may hold backups (the backup store
// and the main store, which takes them when the backup store is down): a
// snapshot, complete or not, is deleted once it's KEEP_DAYS old, so records
// deleted from the site are gone from backups within KEEP_DAYS, as the privacy
// policy says. Run by the nightly backup and again by the daily clean-up, so
// expiry doesn't depend on the backup itself succeeding. Also reports the
// newest complete snapshot, and raises an alert when it's gone stale.
const SNAPSHOT = /^backups\/(\d{4}-\d{2}-\d{2})\.json\.gz$/;
const ATTEMPT = /^backups\/incomplete\/(\d{4}-\d{2}-\d{2})\//;
export const STALE_AFTER_DAYS = 2;
export async function expireBackups({ now = Date.now(), alertStale = process.env.VERCEL_ENV === "production" } = {}) {
  const cutoff = dayOf(now - KEEP_DAYS * 86_400_000);
  const out = { pruned: 0, incompletePruned: 0, failed: 0, newest: null, stale: false };
  for (const store of backupTargets()) {
    try {
      const keys = await store.list("backups/");
      const day = (k) => SNAPSHOT.exec(k)?.[1] ?? ATTEMPT.exec(k)?.[1];
      const expired = keys.filter((k) => day(k) && day(k) <= cutoff);
      for (const k of keys) {
        const d = SNAPSHOT.exec(k)?.[1];
        if (d && d > cutoff && (!out.newest || d > out.newest)) out.newest = d;
      }
      if (expired.length) await store.del(expired);
      out.pruned += expired.filter((k) => SNAPSHOT.test(k)).length;
      out.incompletePruned += expired.filter((k) => ATTEMPT.test(k)).length;
    } catch (err) {
      out.failed++;
      console.error("[backup] expiry", err.message);
    }
  }
  // (Only production promises a backup a night; a preview or test store may have none.)
  out.stale = alertStale && !out.failed && (!out.newest || out.newest < dayOf(now - STALE_AFTER_DAYS * 86_400_000));
  if (out.stale) console.error(`[backup] stale: the newest complete backup is ${out.newest || "missing"} (more than ${STALE_AFTER_DAYS} days old)`);
  return out;
}

// By default, read the newest complete, error-free recovery point. An explicit
// key also permits an incomplete attempt, for deliberate administrative repair.
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
  for (const name of [...new Set(candidates.map((c) => c.name))]) {
    const copies = [];
    for (const { store } of candidates.filter((c) => c.name === name)) {
      try {
        const buf = await store.get(name);
        if (!buf) continue;
        const snapshot = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
        // Version 3 snapshots are judged on their records (photo copies are
        // carried across runs); older ones also needed every photo copied.
        if (!key && (!snapshot.complete || snapshot.failed || snapshot.photos?.failed || (snapshot.version < 3 && snapshot.photos?.complete === false))) continue;
        copies.push({ key: name, ...snapshot });
      } catch (err) { failure = err; }
    }
    // A later same-day fallback can be newer than the dedicated-store copy.
    copies.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
    if (copies.length) return copies[0];
  }
  if (failure) throw failure;
  return null;
}
