// Daily storage clean-up, run by Vercel Cron (vercel.json -> GET /api/cron/cleanup).
//
//  0. Account deletions that stopped partway (a storage time-out) are
//     finished: a marker older than DELETION_STUCK_MS not yet marked erased.
//  1. Orphaned shoot files: media/<sid>/… and shots/<sid>/… whose shoot no
//     longer exists. Deleting a shoot removes both, but a render that was
//     still finishing (e.g. the optional widened square) can write a file
//     just after; the renderer deletes those itself, and this catches the rest.
//  2. Abandoned drafts: shoots that were never developed and haven't changed
//     for DRAFT_RETENTION_DAYS, with their photos (the privacy policy says so).
//     An abandoned team shoot's paid shoot goes back to its team admin.
//  3. Contact-form messages older than CONTACT_RETENTION_DAYS (the privacy
//     policy says 12 months). The emailed copy in our inbox is separate.
//  4. Contact-form rate-limit counters older than two days.
//
// Built to keep working as storage grows: shoots are checked a few at a time
// in parallel, the run stops before the function's time limit, and the next
// day's run resumes where it stopped (cron/cleanup-state.json), wrapping round
// once it reaches the end.

import { list, listFolders, del, getJSON, putJSON, UNCHANGED } from "./storage.js";
import { shoots, users } from "./store.js";
import { maintainPhotoBackups } from "./photo-backup.js";
import { expireBackups } from "./backup.js";
import { returnSeat, expireInvites, finishGiveBacks, releaseDeveloping } from "./teams.js";
import { ensureShootJob } from "./shoot-jobs.js";
import { advance } from "./pipeline.js";
import { finishDeletion } from "./account-deletion.js";
import { mapLimit } from "./collections.js";

const STUCK = ["checking", "generating", "reviewing"];
const STUCK_AFTER_MS = Number(process.env.STUCK_AFTER_MS || 15 * 60 * 1000);

export const CONTACT_RETENTION_DAYS = 365;
// Message ids start with their timestamp: contact/2026-09-27T20-13-15-123Z-ab12cd34.json.
// Shared with restore (scripts/restore-backup.js), so a backup can't bring one back.
export function contactExpired(key, now = Date.now()) {
  const day = /^contact\/(\d{4}-\d{2}-\d{2})T/.exec(key)?.[1];
  return !!day && Date.parse(`${day}T00:00:00Z`) < now - CONTACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}
export const DRAFT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_KEY = "cron/cleanup-state.json";
// A deletion still running (POST /api/account/delete) is left to the request.
export const DELETION_STUCK_MS = 10 * 60 * 1000;
const DELETIONS_PER_RUN = 20;
const PARALLEL = 8;

// Finishes account deletions that stopped partway (a storage time-out): a
// marker (cancelled/users/<uid>.json) not marked erased and older than
// DELETION_STUCK_MS; one started before markers recorded `at` counts as old.
// The shoots cron runs it every 10 minutes, and the daily clean-up once, both
// from the pending list (lib/store.js beginRemoval), so "within a day" in the
// privacy policy always holds. all: every marker, for a one-off check (the
// daily run stopped reading them all on 24 Nov, owner's decision).
export async function finishStuckDeletions({ now = Date.now(), until = Date.now() + 60_000, all = false } = {}) {
  const out = { finished: 0, errors: 0 };
  const uidOf = (re) => (k) => re.exec(k)?.[1];
  const uids = all
    ? (await list("cancelled/users/")).map(uidOf(/^cancelled\/users\/([\w-]+)\.json$/)).filter(Boolean)
    : (await list("deletions/pending/")).map(uidOf(/^deletions\/pending\/([\w-]+)\.json$/)).filter(Boolean);
  const stuck = [];
  await mapLimit(uids, PARALLEL, async (uid) => {
    if (stuck.length >= DELETIONS_PER_RUN || Date.now() > until) return;
    // (undefined: the read failed; null: there's no marker.)
    const marker = await getJSON(`cancelled/users/${uid}.json`).catch(() => undefined);
    // A pending entry whose deletion finished: tidy it. One with no marker
    // only once it's old (its marker, written just after it, may be on the way).
    if (!all && marker?.erased) return void (await del(`deletions/pending/${uid}.json`).catch(() => {}));
    if (!all && marker === null) {
      const entry = await getJSON(`deletions/pending/${uid}.json`).catch(() => undefined);
      if (entry !== undefined && !(Date.parse(entry?.at || "") > now - DELETION_STUCK_MS)) await del(`deletions/pending/${uid}.json`).catch(() => {});
      return;
    }
    if (marker && !marker.erased && !(Date.parse(marker.at || "") > now - DELETION_STUCK_MS)) stuck.push(uid);
  });
  for (const uid of stuck.slice(0, DELETIONS_PER_RUN)) {
    if (Date.now() > until) break;
    try {
      await finishDeletion(uid);
      out.finished++;
      console.log("[cleanup] finished deletion", uid);
    } catch (err) {
      out.errors++;
      console.error("[cleanup] deletion", uid, err.message);
    }
  }
  return out;
}

// Runs fn over items in order, PARALLEL at a time, until the deadline (at
// least one batch per run, so every run makes progress). Returns the last item
// finished if it stopped early (the resume point), or null if it got through.
// One item failing (a damaged record, a storage error) is logged and counted
// but doesn't stop the run, or every later run would stop at the same place.
async function eachUntil(items, deadline, fn, report) {
  const safe = (item) =>
    Promise.resolve()
      .then(() => fn(item))
      .catch((err) => {
        report.errors++;
        console.error("[cleanup]", item, err.message);
      });
  for (let i = 0; i < items.length; i += PARALLEL) {
    await Promise.all(items.slice(i, i + PARALLEL).map(safe));
    const done = Math.min(i + PARALLEL, items.length);
    if (done < items.length && Date.now() > deadline) return items[done - 1];
  }
  return null;
}

// Items after the saved resume point first, then the rest (wrap round).
const fromCursor = (sorted, cursor) => (cursor ? [...sorted.filter((x) => x > cursor), ...sorted.filter((x) => x <= cursor)] : sorted);

export async function runCleanup({ now = Date.now(), budgetMs = 240_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const report = { orphanShoots: 0, orphanFiles: 0, draftsDeleted: 0, contactDeleted: 0, rateLimitDeleted: 0, invitesExpired: 0, stuckAdvanced: 0, deletionsFinished: 0, errors: 0, finished: true };
  // Each step on its own: one that fails (a storage call timing out) is
  // logged, counted and named in the report, and the others still run.
  const step = async (name, fn, fallback) => {
    try {
      return await fn();
    } catch (err) {
      report.errors++;
      (report.failedSteps ||= []).push(name);
      console.error("[cleanup] step failed, skipped until tomorrow:", name, err.message);
      return fallback;
    }
  };
  // (If the saved place can't be read, it isn't overwritten either.)
  const saved = await step("read state", async () => (await getJSON(STATE_KEY)) || {}, null);
  const state = saved || {};

  const photos = await step("photo backups", () => maintainPhotoBackups({ now, deadline: Math.min(deadline, Date.now() + 30_000) }), { pruned: 0, failed: 0, complete: false });
  report.photoBackupsPruned = photos.pruned;
  report.errors += photos.failed;
  // Record backups expire by age here too, and a stale backup raises an alert,
  // even on days the backup job itself didn't run.
  const backups = await step("record backups", () => expireBackups({ now }), { pruned: 0, incompletePruned: 0, failed: 0 });
  report.backupsPruned = backups.pruned + backups.incompletePruned;
  report.newestBackup = backups.newest;
  report.errors += backups.failed + (backups.stale ? 1 : 0);

  // 0. Account deletions that stopped partway (the pending list, as the
  // shoots cron checks every 10 minutes).
  await step("unfinished deletions", async () => {
    const r = await finishStuckDeletions({ now, until: Math.min(deadline, Date.now() + 60_000) });
    report.deletionsFinished += r.finished;
    report.errors += r.errors;
  });

  // 1. Orphaned files. Only the shoot folders are listed up front (one entry
  // per shoot, not per file); a folder's files are listed once it's orphaned.
  const isSid = (x) => /^sht_[\w-]+$/.test(x);
  // (If the listing fails, the saved place is kept for tomorrow.)
  const folderSids = await step("orphaned files", async () => [...new Set([...(await listFolders("media/")), ...(await listFolders("shots/"))])].filter(isSid).sort(), null);
  const orphanStop = !folderSids ? state.orphans ?? null : await eachUntil(fromCursor(folderSids, state.orphans), deadline, async (sid) => {
    if (await getJSON(`shoots/${sid}.json`)) return;
    const keys = [...(await list(`media/${sid}/`)), ...(await list(`shots/${sid}/`))];
    if (!keys.length) return;
    await del(keys);
    report.orphanShoots++;
    report.orphanFiles += keys.length;
  }, report);

  // 2. Abandoned drafts: never developed (no frames planned), not a sample,
  // and untouched for DRAFT_RETENTION_DAYS.
  const draftCutoff = now - DRAFT_RETENTION_DAYS * DAY_MS;
  const sids = await step("abandoned drafts", async () => (await list("shoots/")).map((k) => /^shoots\/(sht_[\w-]+)\.json$/.exec(k)?.[1]).filter(Boolean).sort(), null);
  const draftStop = !sids ? state.drafts ?? null : await eachUntil(fromCursor(sids, state.drafts), deadline, async (sid) => {
    const meta = await shoots.getMeta(sid);
    if (!meta || meta.sample || (meta.shots || []).length) return;
    const last = Date.parse(meta.updatedAt || meta.createdAt || "");
    if (!(last < draftCutoff)) return;
    // Marked first, atomically, so a develop that starts this very moment
    // (which changes the status) wins and the shoot is left alone.
    const marked = await shoots.updateMeta(sid, (m) => (m.status !== meta.status || (m.shots || []).length || m.sample || !(Date.parse(m.updatedAt || m.createdAt || "") < draftCutoff) ? false : void (m.status = "deleting")));
    if (!marked) return;
    await shoots.remove(meta);
    if (meta.team) await returnSeat(meta);
    // A develop charge stranded on the account for it comes back (lib/teams.js).
    if (meta.userId) await users.update(meta.userId, (u) => (releaseDeveloping(u, sid) ? undefined : UNCHANGED)).catch((err) => (err.status === 410 ? null : console.error("[cleanup] develop charge", sid, err.message)));
    report.draftsDeleted++;
  }, report);

  // 3. Contact-form messages past their retention.
  await step("contact messages", async () => {
    const oldMessages = (await list("contact/")).filter((k) => contactExpired(k, now));
    if (oldMessages.length) await del(oldMessages);
    report.contactDeleted = oldMessages.length;
  });

  // 4. Rate-limit counters are named by hour or quarter-hour:
  // ratelimit/contact/<ip>/2026-09-28T13.json, ratelimit/signin/<email>/2026-09-28T13-2.json.
  await step("rate-limit counters", async () => {
    const oldCounters = (await list("ratelimit/")).filter((k) => {
      const hour = /\/(\d{4}-\d{2}-\d{2}T\d{2})(?:-\d)?\.json$/.exec(k)?.[1];
      return hour && Date.parse(`${hour}:00:00Z`) < now - 2 * DAY_MS;
    });
    if (oldCounters.length) await del(oldCounters);
    report.rateLimitDeleted = oldCounters.length;
  });

  // 5. Unopened team invitations lapse after INVITE_TTL_DAYS (lib/teams.js),
  // giving each shoot back to the admin.
  for (const key of await step("team invitations", () => list("teams/"), [])) {
    try {
      const team = await getJSON(key);
      report.invitesExpired += await expireInvites(team, now);
      // (A seat returned while storage failed: its shoot goes back now.)
      const owed = await finishGiveBacks(team);
      if (owed) report.seatsGivenBack = (report.seatsGivenBack || 0) + owed;
    } catch (err) {
      report.errors++;
      console.error("[cleanup] invites", key, err.message);
    }
  }

  // 6. Repair abandoned legacy shoots, checks and expired claims. Live shoots
  // gain a durable delivery if they predate jobs or their intent is missing;
  // advance also applies the existing timeouts and ready-email recovery.
  for (const sid of sids || []) {
    if (Date.now() > deadline) break;
    try {
      const meta = await shoots.getMeta(sid);
      if (!meta || !STUCK.includes(meta.status) || !(Date.parse(meta.updatedAt || meta.createdAt || "") < now - STUCK_AFTER_MS)) continue;
      await ensureShootJob(sid);
      const after = await advance(sid);
      if (after && after.status !== meta.status) report.stuckAdvanced++;
    } catch (err) {
      report.errors++;
      console.error("[cleanup] stuck shoot", sid, err.message);
    }
  }

  // Where tomorrow's run picks up (nothing saved means start from the top).
  report.finished = !orphanStop && !draftStop && photos.complete && !report.failedSteps;
  if (saved) await step("save state", () => putJSON(STATE_KEY, { orphans: orphanStop, drafts: draftStop, at: new Date(now).toISOString() }));
  return report;
}
