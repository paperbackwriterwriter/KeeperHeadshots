// Site-wide limit on image renders running at once, across every shoot and
// every server instance. Each shoot already renders at most 2 frames at a
// time (pipeline.js CONCURRENCY), but Gemini's per-minute quota is shared by
// the whole site, so a few shoots developing together could trip it and
// everyone would wait on retries. A frame now also needs one of RENDER_SLOTS
// site slots; when they're all taken it stays queued and a later progress
// poll starts it.
//
// The slots live in one small record (renders/active.json) of leases keyed by
// the frame's claim id. A lease ends when the render finishes, or on its own
// after `until` (the frame's render lease), so a crashed server can't hold a
// slot for long.

import { createJSON, getJSON, updateJSON, UNCHANGED } from "./storage.js";

// 4 renders at once stays well under Gemini's 20 image requests a minute (a render
// takes tens of seconds), leaving room for retakes and square widening. Raise
// it with RENDER_SLOTS after raising the Gemini quota.
export const RENDER_SLOTS = Number(process.env.RENDER_SLOTS || 4);
const KEY = "renders/active.json";

const live = (leases = {}, now = Date.now()) => Object.entries(leases).filter(([, l]) => l.until > now);

// True if this claim got a slot. A cheap read first, so polls while the
// studio is full don't write.
export async function acquireSlot(claim, { sid, shotId, until }) {
  const now = Date.now();
  const current = await getJSON(KEY);
  if (current && live(current.leases, now).length >= RENDER_SLOTS) return false;
  if (!current) await createJSON(KEY, { leases: {} });
  let got = false;
  await updateJSON(KEY, (r) => {
    got = false; // the callback may run again after a write conflict
    const leases = Object.fromEntries(live(r.leases, now)); // expired leases drop out
    if (Object.keys(leases).length >= RENDER_SLOTS) return UNCHANGED;
    leases[claim] = { sid, shotId, until: typeof until === "number" ? until : Date.parse(until) };
    got = true;
    return { ...r, leases };
  });
  return got;
}

export async function releaseSlot(claim) {
  await updateJSON(KEY, (r) => {
    if (!r.leases?.[claim]) return UNCHANGED;
    const leases = { ...r.leases };
    delete leases[claim];
    return { ...r, leases };
  });
}

