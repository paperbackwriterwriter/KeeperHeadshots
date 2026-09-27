// Daily storage clean-up, run by Vercel Cron (vercel.json -> GET /api/cron/cleanup).
//
//  1. Orphaned shoot files: media/<sid>/… and shots/<sid>/… whose shoot no
//     longer exists. Deleting a shoot removes both, but a render that was
//     still finishing (e.g. the optional widened square) can write a file
//     just after; the renderer deletes those itself, and this catches the rest.
//  2. Contact-form messages older than CONTACT_RETENTION_DAYS (the privacy
//     policy says 12 months). The emailed copy in our inbox is separate.

import { list, del, getJSON } from "./storage.js";

export const CONTACT_RETENTION_DAYS = 365;

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

export async function runCleanup({ now = Date.now() } = {}) {
  const report = { orphanShoots: 0, orphanFiles: 0, contactDeleted: 0 };

  const groups = bySid([...(await list("media/")), ...(await list("shots/"))]);
  for (const [sid, keys] of groups) {
    if (await getJSON(`shoots/${sid}.json`)) continue;
    await del(keys);
    report.orphanShoots++;
    report.orphanFiles += keys.length;
  }

  // Message ids start with their timestamp: 2026-09-27T20-13-15-123Z-ab12cd34.
  const cutoff = now - CONTACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const old = (await list("contact/")).filter((k) => {
    const day = /^contact\/(\d{4}-\d{2}-\d{2})T/.exec(k)?.[1];
    return day && Date.parse(`${day}T00:00:00Z`) < cutoff;
  });
  if (old.length) await del(old);
  report.contactDeleted = old.length;

  return report;
}
