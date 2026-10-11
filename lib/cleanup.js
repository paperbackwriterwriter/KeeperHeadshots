// Daily storage clean-up, run by Vercel Cron (vercel.json -> GET /api/cron/cleanup).
//
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

import { list, listFolders, del, getJSON, putJSON } from "./storage.js";
import { shoots } from "./store.js";
import { returnSeat, expireInvites } from "./teams.js";
import { ensureShootJob } from "./shoot-jobs.js";
import { advance } from "./pipeline.js";

const STUCK = ["checking", "generating", "reviewing"];
const STUCK_AFTER_MS = Number(process.env.STUCK_AFTER_MS || 15 * 60 * 1000);

export const CONTACT_RETENTION_DAYS = 365;
export const DRAFT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_KEY = "cron/cleanup-state.json";
const PARALLEL = 8;

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
  const state = (await getJSON(STATE_KEY)) || {};
  const report = { orphanShoots: 0, orphanFiles: 0, draftsDeleted: 0, contactDeleted: 0, rateLimitDeleted: 0, invitesExpired: 0, stuckAdvanced: 0, errors: 0, finished: true };

  // 1. Orphaned files. Only the shoot folders are listed up front (one entry
  // per shoot, not per file); a folder's files are listed once it's orphaned.
  const isSid = (x) => /^sht_[\w-]+$/.test(x);
  const folderSids = [...new Set([...(await listFolders("media/")), ...(await listFolders("shots/"))])].filter(isSid).sort();
  const orphanStop = await eachUntil(fromCursor(folderSids, state.orphans), deadline, async (sid) => {
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
  const sids = (await list("shoots/")).map((k) => /^shoots\/(sht_[\w-]+)\.json$/.exec(k)?.[1]).filter(Boolean).sort();
  const draftStop = await eachUntil(fromCursor(sids, state.drafts), deadline, async (sid) => {
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
    report.draftsDeleted++;
  }, report);

  // 3. Message ids start with their timestamp: 2026-09-27T20-13-15-123Z-ab12cd34.
  const contactCutoff = now - CONTACT_RETENTION_DAYS * DAY_MS;
  const oldMessages = (await list("contact/")).filter((k) => {
    const day = /^contact\/(\d{4}-\d{2}-\d{2})T/.exec(k)?.[1];
    return day && Date.parse(`${day}T00:00:00Z`) < contactCutoff;
  });
  if (oldMessages.length) await del(oldMessages);
  report.contactDeleted = oldMessages.length;

  // 4. Rate-limit counters are named by hour or quarter-hour:
  // ratelimit/contact/<ip>/2026-09-28T13.json, ratelimit/signin/<email>/2026-09-28T13-2.json.
  const oldCounters = (await list("ratelimit/")).filter((k) => {
    const hour = /\/(\d{4}-\d{2}-\d{2}T\d{2})(?:-\d)?\.json$/.exec(k)?.[1];
    return hour && Date.parse(`${hour}:00:00Z`) < now - 2 * DAY_MS;
  });
  if (oldCounters.length) await del(oldCounters);
  report.rateLimitDeleted = oldCounters.length;

  // 5. Unopened team invitations lapse after INVITE_TTL_DAYS (lib/teams.js),
  // giving each shoot back to the admin.
  for (const key of await list("teams/")) {
    try {
      report.invitesExpired += await expireInvites(await getJSON(key), now);
    } catch (err) {
      report.errors++;
      console.error("[cleanup] invites", key, err.message);
    }
  }

  // 6. Repair abandoned legacy shoots, checks and expired claims. Live shoots
  // gain a durable delivery if they predate jobs or their intent is missing;
  // advance also applies the existing timeouts and ready-email recovery.
  for (const sid of sids) {
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
  report.finished = !orphanStop && !draftStop;
  await putJSON(STATE_KEY, { orphans: orphanStop, drafts: draftStop, at: new Date(now).toISOString() });
  return report;
}
