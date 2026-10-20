// Photos are separate private binary objects, never base64 in record snapshots.
// Daily copies have a strict expiry, including after incomplete backup runs.
// Random-ID / hashed-path tombstones survive account deletion and are mirrored
// to the backup store so recovery cannot undo an intentional erasure.
import crypto from "node:crypto";
import * as storage from "./storage.js";
import { target, mainTarget, usesSeparate, backupTargets } from "./backup-target.js";

const DAY = 86_400_000;
// The public privacy policy promises at most seven days, even if misconfigured.
export const PHOTO_KEEP_DAYS = Math.min(7, Math.max(1, Number(process.env.PHOTO_BACKUP_KEEP_DAYS) || 7));
const digest = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const validUid = (v) => /^usr_[\w-]+$/.test(v || "");
const validSid = (v) => /^sht_[\w-]+$/.test(v || "");
const validPhoto = (k) => /^media\/sht_[\w-]+\/[\w-]+\.(?:jpg|jpeg|png|webp|svg)$/.test(k) || /^showcase\/shc_[\w-]+\.jpg$/.test(k);
const erasedKey = (kind, id) => `photo-erased/${kind}/${id}.json`;
const fileId = (key) => digest(key);
// A storage hiccup (a 5xx, a dropped connection) is tried again twice, a
// moment apart, before the photo counts as failed and the day's backup as
// incomplete.
const TRANSIENT = /\b5\d\d\b|Internal Server Error|Service Unavailable|Bad Gateway|timed? ?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i;
export async function retried(fn, { tries = 3, waitMs = 500 } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (err) {
      if (i >= tries || !(err?.status >= 500 || TRANSIENT.test(String(err?.message || "")))) throw err;
      await new Promise((r) => setTimeout(r, waitMs * i));
    }
  }
}
const contentType = (key) => key.endsWith(".svg") ? "image/svg+xml" : key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";

function parseCopy(key) {
  const m = /^photo-backups\/(usr_[\w-]+)\/(sht_[\w-]+|showcase)\/([a-f0-9]{64})\/(\d{4}-\d{2}-\d{2})(?:-[a-f0-9]{16})?\.(jpg|jpeg|png|webp|svg)$/.exec(key);
  return m && { uid: m[1], sid: m[2] === "showcase" ? null : m[2], fileId: m[3], day: m[4] };
}
function markerKeys({ uid, sid, fileId: fid }) {
  return [erasedKey("users", uid), ...(sid ? [erasedKey("shoots", sid)] : []), erasedKey("files", fid)];
}
async function erased(info, remote = false) {
  const keys = markerKeys(info);
  if ((await Promise.all(keys.map(storage.getJSON))).some(Boolean)) return true;
  if (await storage.getJSON(`cancelled/users/${info.uid}.json`)) return true;
  if (info.sid && await storage.getJSON(`cancelled/shoots/${info.sid}.json`)) return true;
  // Restore fails closed if the configured separate store cannot be checked.
  return remote && usesSeparate() && (await Promise.all(keys.map((k) => target.get(k)))).some(Boolean);
}

async function finishPurge(intent) {
  for (const store of backupTargets()) {
    await store.put(intent.marker, Buffer.from('{"erased":true}'), "application/json");
    const copies = await store.list(intent.prefix);
    await store.del(copies.filter((key) => {
      const info = parseCopy(key);
      return info && (intent.kind === "users" ? info.uid === intent.id : intent.kind === "shoots" ? info.sid === intent.id : info.fileId === intent.id);
    }));
  }
  await storage.del(intent.pending);
}
async function purge(kind, id, prefix) {
  const marker = erasedKey(kind, id);
  const pending = `photo-purge/${kind}/${id}.json`;
  const intent = { kind, id, prefix, marker, pending };
  // Persist the guard and retry intent BEFORE external I/O or removing originals.
  await storage.putJSON(marker, { erased: true });
  await storage.putJSON(pending, intent);
  try { await finishPurge(intent); }
  catch (err) { console.error("[photo-backup] erasure pending", kind, id, err.message); }
}
export const purgeUserPhotos = (uid) => {
  if (!validUid(uid)) throw new Error("Invalid photo owner");
  return purge("users", uid, `photo-backups/${uid}/`);
};
export const purgeShootPhotos = (sid, uid) => {
  if (!validSid(sid)) throw new Error("Invalid shoot");
  return purge("shoots", sid, validUid(uid) ? `photo-backups/${uid}/${sid}/` : "photo-backups/");
};
export const purgePhoto = async (key) => {
  if (!validPhoto(key)) throw new Error("Invalid photo key");
  const sid = key.startsWith("media/") ? key.split("/")[1] : null;
  const owner = await storage.getJSON(sid ? `shoots/${sid}.json` : key.replace(/\.jpg$/, ".json"));
  const folder = sid || (validSid(owner?.shootId) ? owner.shootId : "showcase");
  const prefix = validUid(owner?.userId) ? `photo-backups/${owner.userId}/${folder}/${fileId(key)}/` : "photo-backups/";
  return purge("files", fileId(key), prefix);
};

// Run from both daily cleanup and backup, so a failed backup can't stop expiry.
export async function maintainPhotoBackups({ now = Date.now(), deadline = Date.now() + 30_000 } = {}) {
  const report = { pruned: 0, failed: 0, complete: true };
  for (const key of (await storage.list("photo-purge/")).sort()) {
    if (Date.now() >= deadline) { report.complete = false; break; }
    try { await finishPurge(await storage.getJSON(key)); }
    catch (err) { report.failed++; console.error("[photo-backup] erasure retry", err.message); }
  }
  for (const store of backupTargets()) {
    if (Date.now() >= deadline) { report.complete = false; break; }
    // The copies are read a page at a time, checking the time budget between
    // pages, and a run that runs out of time resumes at its page next run.
    const stateKey = `cron/photo-maintain-${store === mainTarget ? "main" : "backup"}.json`;
    try {
      // Read marker names once, rather than several storage reads per daily copy.
      const markers = new Set([...await storage.list("photo-erased/"), ...await storage.list("cancelled/"), ...await store.list("photo-erased/")]);
      let cursor = (await storage.getJSON(stateKey))?.cursor || null;
      let restarted = false;
      do {
        if (Date.now() >= deadline) { report.complete = false; break; }
        let page;
        try { page = await store.listPage("photo-backups/", cursor); }
        catch (err) {
          // A saved position the store no longer accepts: start over once.
          if (!cursor || restarted) throw err;
          cursor = null; restarted = true; continue;
        }
        let finished = true;
        // Also catches orphan copies left by a crash before writing a manifest.
        for (const key of page.keys) {
          if (Date.now() >= deadline) { report.complete = false; finished = false; break; }
          const info = parseCopy(key);
          if (info && (Date.parse(`${info.day}T00:00:00Z`) + PHOTO_KEEP_DAYS * DAY <= now || markerKeys(info).some((k) => markers.has(k)) || markers.has(`cancelled/users/${info.uid}.json`) || (info.sid && markers.has(`cancelled/shoots/${info.sid}.json`)))) {
            await store.del([key]); report.pruned++;
          }
        }
        if (!finished) break; // this page again next run
        cursor = page.cursor;
        await storage.putJSON(stateKey, { cursor });
      } while (cursor);
    } catch (err) { report.failed++; console.error("[photo-backup] cleanup", err.message); }
  }
  return report;
}

// recordsComplete: whether `records` holds every record. When the record read
// ran out of time, a photo whose record wasn't read is still carried forward
// (deletion is known from the erasure markers, not from a missing record).
export async function backupPhotos({ records, now, deadline, attempt = crypto.randomBytes(8).toString("hex"), recordsComplete = true }) {
  const maintenance = await maintainPhotoBackups({ now, deadline: Math.min(deadline, Date.now() + 30_000) });
  const report = { complete: true, failed: maintenance.failed, pruned: maintenance.pruned, bytes: 0, entries: [] };
  let store = mainTarget;
  let separate = usesSeparate();
  if (separate) {
    try { await target.list("photo-backups/"); store = target; }
    catch (err) { separate = false; console.error("[backup] backup store unavailable, photos saved to the main store instead:", err.message); }
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const sorted = [...await storage.list("media/"), ...(await storage.list("showcase/")).filter((k) => k.endsWith(".jpg"))].sort();
  const cursorKey = "cron/photo-backup-state.json";
  const cursor = (await storage.getJSON(cursorKey))?.cursor;
  const keys = cursor ? [...sorted.filter((k) => k > cursor), ...sorted.filter((k) => k <= cursor)] : sorted;
  // Two files at a time bounds memory to two images rather than a whole account.
  for (let i = 0; i < keys.length; i += 2) {
    if (Date.now() >= deadline) { report.complete = false; break; }
    await Promise.all(keys.slice(i, i + 2).map(async (key) => {
      try {
        if (!validPhoto(key)) return;
        const sid = key.startsWith("media/") ? key.split("/")[1] : null;
        const recordKey = sid ? `shoots/${sid}.json` : key.replace(/\.jpg$/, ".json");
        const owner = records[recordKey];
        if (!validUid(owner?.userId)) return; // orphan, missing metadata or no owner
        const info = { uid: owner.userId, sid: sid || (validSid(owner.shootId) ? owner.shootId : null), fileId: fileId(key) };
        if (await erased(info, separate) || !await storage.getJSON(recordKey)) return;
        const buf = await retried(() => storage.getFile(key));
        if (!buf) return;
        const backupKey = `photo-backups/${info.uid}/${info.sid || "showcase"}/${info.fileId}/${day}-${attempt}.${key.split(".").pop()}`;
        await retried(() => store.put(backupKey, buf, contentType(key)));
        // Deletion can overlap the remote upload, after its initial prefix sweep.
        try {
          if (await erased(info, separate) || !await storage.getJSON(recordKey)) { await store.del([backupKey]); return; }
        } catch (err) { await store.del([backupKey]); throw err; }
        report.entries.push({ key, backupKey, uid: info.uid, sid: info.sid, sha256: digest(buf), bytes: buf.length, contentType: contentType(key), store: separate ? "separate" : "main", expiresAt: new Date(Date.parse(`${day}T00:00:00Z`) + PHOTO_KEEP_DAYS * DAY).toISOString() });
        report.bytes += buf.length;
      } catch (err) { report.failed++; console.error("[photo-backup] copy", key, err.message); }
    }));
    // Resume after the last attempted batch on a busy night, instead of
    // continually backing up only the first accounts in lexical order.
    await storage.putJSON(cursorKey, { cursor: keys[Math.min(i + 2, keys.length) - 1] });
  }
  report.passComplete = report.complete; // this run reached every photo
  if (report.complete) await storage.del(cursorKey);
  // A busy night copies only part of the photos, so copies accumulate across
  // runs in a persistent manifest: an earlier copy is carried forward while
  // it's unexpired, its photo still exists with the same owner, and it hasn't
  // been erased. The snapshot's manifest is then every photo's latest copy,
  // and `pending` counts photos with no copy yet.
  const copied = new Set(report.entries.map((e) => e.key));
  const current = new Set(sorted);
  // Erasure markers, read once: the main store's, and the backup store's copies
  // (which outlive a loss of the main store's).
  const markers = new Set([...await storage.list("photo-erased/"), ...await storage.list("cancelled/"), ...(separate ? await target.list("photo-erased/").catch(() => []) : [])]);
  const isErased = (info) => markerKeys(info).some((k) => markers.has(k)) || markers.has(`cancelled/users/${info.uid}.json`) || (info.sid && markers.has(`cancelled/shoots/${info.sid}.json`));
  const prior = (await storage.getJSON(MANIFEST_KEY))?.entries || [];
  for (const e of prior) {
    if (copied.has(e.key) || !current.has(e.key) || !(Date.parse(e.expiresAt) > now)) continue;
    const info = parseCopy(e.backupKey);
    if (!info || info.uid !== e.uid) continue;
    const recordKey = e.key.startsWith("media/") ? `shoots/${info.sid}.json` : e.key.replace(/\.jpg$/, ".json");
    const owner = records[recordKey];
    if (owner ? owner.userId !== e.uid : recordsComplete) continue;
    if (isErased(info)) continue;
    report.entries.push({ ...e, carried: true });
    copied.add(e.key);
  }
  // Erased photos are never copied, so they don't count as waiting for one.
  report.pending = 0;
  for (const key of sorted) {
    if (!validPhoto(key) || copied.has(key)) continue;
    const info = ownerInfo(key, records);
    if (info && !isErased(info)) report.pending++;
  }
  await storage.putJSON(MANIFEST_KEY, { at: new Date(now).toISOString(), entries: report.entries });
  // Complete: every photo has a copy, from this run or an earlier one.
  report.complete = report.pending === 0 && maintenance.complete;
  return report;
}

const MANIFEST_KEY = "cron/photo-manifest.json";
// Who a photo belongs to, from the records; null when no record names an
// owner (such photos aren't backed up at all).
function ownerInfo(key, records) {
  const sid = key.startsWith("media/") ? key.split("/")[1] : null;
  const owner = records[sid ? `shoots/${sid}.json` : key.replace(/\.jpg$/, ".json")];
  if (!validUid(owner?.userId)) return null;
  return { uid: owner.userId, sid: sid || (validSid(owner.shootId) ? owner.shootId : null), fileId: fileId(key) };
}

// Record recovery also preserves erasure barriers, rather than bringing back
// accounts or shared entries whose photos were intentionally taken down.
// `fromBackup` reads another record from the same backup (a restore passes it):
// an invitation is judged by its team's admin.
export async function recordErased(key, value, fromBackup = () => null) {
  if (key.startsWith("cancelled/") || key.startsWith("photo-erased/")) return !!await storage.getJSON(key);
  // A team goes with its admin's account (lib/teams.js removeTeam), and its
  // invitations with it; an invitation whose team can't be found isn't kept.
  if (/^teams\/[\w-]+\.json$/.test(key)) return validUid(value?.ownerId) ? recordErased(`users/id/${value.ownerId}.json`, { id: value.ownerId }) : false;
  if (/^invites\/[\w-]+\.json$/.test(key)) {
    const teamKey = `teams/${value?.teamId}.json`;
    const team = (await storage.getJSON(teamKey)) || fromBackup(teamKey);
    return !team || recordErased(teamKey, team);
  }
  // Payment/accounting and hashed usage records intentionally survive erasure.
  if (!/^(?:users\/(?:id|email)\/|idx\/|shoot-catalog\/|showcase-users\/|billing-sync\/|shoots\/|shots\/|jobs\/shoots\/|showcase\/)/.test(key)) return false;
  const uid = key.startsWith("idx/") ? key.split("/")[1] : /^(?:shoot-catalog|showcase-users|billing-sync)\/(usr_[\w-]+)\.json$/.exec(key)?.[1] || value?.userId || (validUid(value?.id) ? value.id : null);
  const sid = /^shoots\/(sht_[\w-]+)\.json$/.exec(key)?.[1] || /^(?:shots|jobs\/shoots)\/(sht_[\w-]+)\//.exec(key)?.[1] || /^idx\/usr_[\w-]+\/(sht_[\w-]+)$/.exec(key)?.[1] || (validSid(value?.shootId) ? value.shootId : null);
  const keys = [...(validUid(uid) ? [erasedKey("users", uid), `cancelled/users/${uid}.json`] : []), ...(sid ? [erasedKey("shoots", sid), `cancelled/shoots/${sid}.json`] : []), ...(key.startsWith("showcase/") ? [erasedKey("files", fileId(key.replace(/\.json$/, ".jpg")))] : [])];
  if ((await Promise.all(keys.map(storage.getJSON))).some(Boolean)) return true;
  return usesSeparate() && (await Promise.all(keys.filter((k) => k.startsWith("photo-erased/")).map((k) => target.get(k)))).some(Boolean);
}

export async function restorePhoto(entry, { apply = false, overwrite = false, now = Date.now(), plannedOwner = null } = {}) {
  const info = parseCopy(entry.backupKey);
  if (!validPhoto(entry.key) || !info || info.uid !== entry.uid || info.sid !== entry.sid || info.fileId !== fileId(entry.key)) throw new Error("Invalid photo manifest");
  if (Date.parse(`${info.day}T00:00:00Z`) + PHOTO_KEEP_DAYS * DAY <= now || Date.parse(entry.expiresAt) <= now) return "expired";
  if (await erased(info, true)) return "erased";
  const recordKey = entry.key.startsWith("media/") ? `shoots/${info.sid}.json` : entry.key.replace(/\.jpg$/, ".json");
  const owner = await storage.getJSON(recordKey) || (!apply ? plannedOwner : null);
  if (owner?.userId !== info.uid) return "missing-owner";
  if (!overwrite && await storage.getFile(entry.key)) return "exists";
  const store = entry.store === "main" ? mainTarget : entry.store === "separate" && usesSeparate() ? target : null;
  if (!store) throw new Error("Photo backup store is not configured");
  const buf = await store.get(entry.backupKey);
  if (!buf) return "missing-backup";
  if (buf.length !== entry.bytes || digest(buf) !== entry.sha256) throw new Error("Photo backup checksum mismatch");
  if (apply) {
    // Re-check immediately before and after I/O, including tombstones remote
    // from a restored primary store. Remove any write overlapping erasure.
    if (await erased(info, true)) return "erased";
    if (overwrite) await storage.putFile(entry.key, buf, contentType(entry.key));
    else if (!await storage.createFile(entry.key, buf, contentType(entry.key))) return "exists";
    try {
      if (await erased(info, true) || (await storage.getJSON(recordKey))?.userId !== info.uid) {
        await storage.del(entry.key); return "erased";
      }
    } catch (err) { await storage.del(entry.key); throw err; }
  }
  return apply ? "restored" : "would-restore";
}
