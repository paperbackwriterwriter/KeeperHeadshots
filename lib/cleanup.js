// Daily storage clean-up, run by Vercel Cron (vercel.json -> GET /api/cron/cleanup).
//
//  1. Orphaned shoot files: media/<sid>/… and shots/<sid>/… whose shoot no
//     longer exists. Deleting a shoot removes both, but a render that was
//     still finishing (e.g. the optional widened square) can write a file
//     just after; the renderer deletes those itself, and this catches the rest.
//  2. Abandoned drafts: shoots that were never developed and haven't changed
//     for DRAFT_RETENTION_DAYS, with their photos (the privacy policy says so).
//  3. Contact-form messages older than CONTACT_RETENTION_DAYS (the privacy
//     policy says 12 months). The emailed copy in our inbox is separate.
//  4. Contact-form rate-limit counters older than two days.
//
// Built to keep working as storage grows: shoots are checked a few at a time
// in parallel, the run stops before the function's time limit, and the next
// day's run resumes where it stopped (cron/cleanup-state.json), wrapping round
// once it reaches the end.

import { list, del, getJSON, putJSON } from "./storage.js";
import { shoots } from "./store.js";

export const CONTACT_RETENTION_DAYS = 365;
export const DRAFT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_KEY = "cron/cleanup-state.json";
const PARALLEL = 8;

// Groups keys like "media/<sid>/<file>" (Blob lists files) or "media/<sid>"
// (local disk lists folders) by shoot id.
function bySid(keys) {
  const groups = new Map();
  for (const k of keys) {
    const sid = k.split("/")[1];
    if (!/^sht_[\w-]+$/.test(sid || "")) continue;
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid).push(k);
  }
  return groups;
}

// Runs fn over items in order, PARALLEL at a time, until the deadline (at
// least one batch per run, so every run makes progress). Returns the last item
// finished if it stopped early (the resume point), or null if it got through.
async function eachUntil(items, deadline, fn) {
  for (let i = 0; i < items.length; i += PARALLEL) {
    await Promise.all(items.slice(i, i + PARALLEL).map(fn));
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
  const report = { orphanShoots: 0, orphanFiles: 0, draftsDeleted: 0, contactDeleted: 0, rateLimitDeleted: 0, finished: true };

  // 1. Orphaned files.
  const groups = bySid([...(await list("media/")), ...(await list("shots/"))]);
  const orphanStop = await eachUntil(fromCursor([...groups.keys()].sort(), state.orphans), deadline, async (sid) => {
    if (await getJSON(`shoots/${sid}.json`)) return;
    const keys = groups.get(sid);
    await del(keys);
    report.orphanShoots++;
    report.orphanFiles += keys.length;
  });

  // 2. Abandoned drafts: never developed (no frames planned), not a sample,
  // and untouched for DRAFT_RETENTION_DAYS.
  const draftCutoff = now - DRAFT_RETENTION_DAYS * DAY_MS;
  const sids = (await list("shoots/")).map((k) => /^shoots\/(sht_[\w-]+)\.json$/.exec(k)?.[1]).filter(Boolean).sort();
  const draftStop = await eachUntil(fromCursor(sids, state.drafts), deadline, async (sid) => {
    const meta = await shoots.getMeta(sid);
    if (!meta || meta.sample || (meta.shots || []).length) return;
    const last = Date.parse(meta.updatedAt || meta.createdAt || "");
    if (!(last < draftCutoff)) return;
    await shoots.remove(meta);
    report.draftsDeleted++;
  });

  // 3. Message ids start with their timestamp: 2026-09-27T20-13-15-123Z-ab12cd34.
  const contactCutoff = now - CONTACT_RETENTION_DAYS * DAY_MS;
  const oldMessages = (await list("contact/")).filter((k) => {
    const day = /^contact\/(\d{4}-\d{2}-\d{2})T/.exec(k)?.[1];
    return day && Date.parse(`${day}T00:00:00Z`) < contactCutoff;
  });
  if (oldMessages.length) await del(oldMessages);
  report.contactDeleted = oldMessages.length;

  // 4. Rate-limit counters are named by hour: ratelimit/contact/<ip>/2026-09-28T13.json.
  const oldCounters = (await list("ratelimit/")).filter((k) => {
    const hour = /\/(\d{4}-\d{2}-\d{2}T\d{2})\.json$/.exec(k)?.[1];
    return hour && Date.parse(`${hour}:00:00Z`) < now - 2 * DAY_MS;
  });
  if (oldCounters.length) await del(oldCounters);
  report.rateLimitDeleted = oldCounters.length;

  // Where tomorrow's run picks up (nothing saved means start from the top).
  report.finished = !orphanStop && !draftStop;
  await putJSON(STATE_KEY, { orphans: orphanStop, drafts: draftStop, at: new Date(now).toISOString() });
  return report;
}
