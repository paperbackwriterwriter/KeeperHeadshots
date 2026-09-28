// Rate limits counted in storage, so every server instance shares the count.
// Counters live at ratelimit/<bucket>/<hash of id>/<window>.json, named by
// clock hour (2026-09-28T13), quarter-hour (2026-09-28T13-2) or day
// (2026-09-28T00); the daily clean-up deletes them after two days.

import crypto from "node:crypto";
import { createJSON, updateJSON } from "./storage.js";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const hashId = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 32);

function windowName(windowMs, now = new Date()) {
  const hour = now.toISOString().slice(0, 13);
  if (windowMs >= DAY_MS) return `${hour.slice(0, 10)}T00`;
  return windowMs >= HOUR_MS ? hour : `${hour}-${Math.floor(now.getUTCMinutes() / (windowMs / 60000))}`;
}

export const counterKey = (bucket, id, windowMs = HOUR_MS) => `ratelimit/${bucket}/${hashId(id)}/${windowName(windowMs)}.json`;

// Atomically applies fn to this window's counter record ({} to start) and
// returns what fn returned.
export async function withCounter(bucket, id, windowMs, fn) {
  const key = counterKey(bucket, id, windowMs);
  await createJSON(key, {});
  let out;
  await updateJSON(key, (r) => {
    out = fn(r);
    return r;
  });
  return out;
}

// Counts one hit; true once there have been more than `limit` in the window.
export const overLimit = (bucket, id, limit, windowMs = HOUR_MS) =>
  withCounter(bucket, id, windowMs, (r) => (r.n = (r.n || 0) + 1) > limit);
