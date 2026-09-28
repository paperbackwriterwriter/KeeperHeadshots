// The sign-up funnel, counted as it happens: how many people reach each step
// for the first time on a given day, plus every purchase and its revenue.
//
//   stats/days/<YYYY-MM-DD>.json   { signup, verified, checked, developed, buyer, purchases, revenue }
//   stats/seen/<step>/<userId>.json  write-once marker, so each person counts once per step
//
// Demo and owner accounts aren't counted. Counting never blocks the action it
// records: callers ignore failures (a missed count beats a failed sign-up).
// Visitors aren't here; they're in Vercel Web Analytics.

import { createJSON, getJSON, updateJSON } from "./storage.js";
import { planFor } from "./plan.js";

export const STEPS = ["signup", "verified", "checked", "developed", "buyer"];
const DAY_MS = 24 * 60 * 60 * 1000;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
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

// Day-by-day counts for the last `days` days (today included), newest first,
// with totals.
export async function funnelReport(days = 30) {
  const dates = Array.from({ length: days }, (_, i) => day(Date.now() - i * DAY_MS));
  const rows = await Promise.all(dates.map(async (date) => ({ date, ...((await getJSON(`stats/days/${date}.json`)) || {}) })));
  const keys = [...STEPS, "purchases", "revenue"];
  const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((n, r) => n + (r[k] || 0), 0)]));
  return { days, since: dates[dates.length - 1], rows: rows.map((r) => Object.fromEntries([["date", r.date], ...keys.map((k) => [k, r[k] || 0])])), totals };
}
