// The sign-up funnel, counted as it happens: how many people reach each step
// for the first time on a given day, plus every purchase and its revenue.
//
//   stats/days/<YYYY-MM-DD>.json   { signup, verified, checked, developed, buyer, purchases, revenue }
//   stats/seen/<step>/<userId>.json  write-once marker, so each person counts once per step
//
// Demo and owner accounts aren't counted. Counting never blocks the action it
// records: callers ignore failures (a missed count beats a failed sign-up).
// Visitors aren't here; they're in Vercel Web Analytics.

import { createJSON, getJSON, updateJSON, UNCHANGED } from "./storage.js";
import { planFor } from "./plan.js";

export const STEPS = ["signup", "verified", "checked", "developed", "buyer"];
const DAY_MS = 24 * 60 * 60 * 1000;
// Days are the owner's (Central time), so an evening sale lands on the day it was made.
export const TIME_ZONE = process.env.STATS_TIME_ZONE || "America/Chicago";
const day = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const counted = (user) => user && !user.demo && planFor(user).tier !== "owner";

async function bump(fields) {
  const key = `stats/days/${day()}.json`;
  await createJSON(key, {});
  await updateJSON(key, (r) => {
    for (const [k, v] of Object.entries(fields)) r[k] = (r[k] || 0) + v;
    return r;
  });
}

// step: one of STEPS, or "purchase" (with amount in cents and whether it's
// the person's first, which also counts them as a buyer).
export async function recordStep(step, user, { amount = 0, first = false } = {}) {
  if (!counted(user)) return;
  if (step === "purchase") return bump({ purchases: 1, revenue: amount, ...(first ? { buyer: 1 } : {}) });
  if (!STEPS.includes(step)) return;
  if (!(await createJSON(`stats/seen/${step}/${user.id}.json`, { at: new Date().toISOString() }))) return;
  await bump({ [step]: 1 });
}

// A refund, counted on the day it's seen: the amount refunded since last
// time (a payment can be refunded in parts), and the order once.
export async function recordRefund(user, sessionId, refunded) {
  if (!counted(user) || !(refunded > 0)) return;
  const key = `stats/refunds/${sessionId}.json`;
  await createJSON(key, { amount: 0 });
  let delta = 0;
  let first = false;
  await updateJSON(key, (r) => {
    delta = Math.max(0, refunded - (r.amount || 0));
    first = !(r.amount > 0) && delta > 0;
    if (!delta) return UNCHANGED;
    return { ...r, amount: refunded, at: new Date().toISOString() };
  });
  if (delta) await bump({ refunds: delta, ...(first ? { refunded: 1 } : {}) });
}

// A chargeback we won (lib/billing.js): its money came back, so it comes off
// the refund total (on the day it was won), and no longer counts as a
// refunded order if nothing else of it was refunded.
export async function reverseRefund(sessionId, amount, disputeId = "") {
  if (!(amount > 0)) return;
  const key = `stats/refunds/${sessionId}.json`;
  let back = 0;
  let cleared = false;
  await updateJSON(key, (r) => {
    back = 0;
    if (!r || (disputeId && (r.disputesWon || []).includes(disputeId))) return UNCHANGED;
    back = Math.min(amount, r.amount || 0);
    cleared = back > 0 && back === r.amount;
    if (!back) return UNCHANGED;
    return { ...r, amount: r.amount - back, at: new Date().toISOString(), ...(disputeId ? { disputesWon: [...(r.disputesWon || []), disputeId] } : {}) };
  });
  if (back) await bump({ refunds: -back, ...(cleared ? { refunded: -1 } : {}) });
}

// Day-by-day counts for the last `days` days (today included), newest first,
// with totals.
export async function funnelReport(days = 30) {
  const dates = Array.from({ length: days }, (_, i) => day(Date.now() - i * DAY_MS));
  const rows = await Promise.all(dates.map(async (date) => ({ date, ...((await getJSON(`stats/days/${date}.json`)) || {}) })));
  const keys = [...STEPS, "purchases", "revenue", "refunded", "refunds"];
  const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((n, r) => n + (r[k] || 0), 0)]));
  return { days, since: dates[dates.length - 1], rows: rows.map((r) => Object.fromEntries([["date", r.date], ...keys.map((k) => [k, r[k] || 0])])), totals };
}
