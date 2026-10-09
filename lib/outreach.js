// Owner tools on the sales funnel page (/app/funnel):
//
//   reviewShoots — recent customer shoots and how each one went (photo check,
//     frames finished or failed, retakes, grades, whether anything was
//     downloaded, whether the person bought), to judge the free shoots.
//
//   offer — a one-time email with a discount code to people who used their
//     free shoot (or confirmed their email and never developed one) and
//     haven't bought. The owner creates the code in Stripe first (Product
//     catalog → Coupons → promotion code); the checkout page already has an
//     "Add promotion code" field. Each person gets a given code at most once,
//     never after turning reminders off, and the send is capped per run so it
//     can't use up the day's email allowance.

import { list, getJSON, UNCHANGED } from "./storage.js";
import { users, shoots } from "./store.js";
import { planFor } from "./plan.js";
import { isPreview } from "./preview.js";
import { sendMail, mailEnabled, MAIL_FROM, offerEmail } from "./mail.js";
import { unsubscribeToken } from "./reminders.js";
import { billingEnabled, promotionCode } from "./billing.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const OFFER_MAX_PER_RUN = 60;
const SEND_GAP_MS = 300;
const SEND_BUDGET_MS = 200_000;
export const CODE = /^[A-Z0-9][A-Z0-9_-]{2,30}$/;

const customer = (u) => u && !u.demo && planFor(u).tier !== "owner";
const mask = (email) => String(email || "").replace(/^(.)[^@]*(@.*)$/, "$1***$2");
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

async function allUsers() {
  const keys = await list("users/id/");
  return (await inBatches(keys, 16, (k) => getJSON(k).catch(() => null))).filter(customer);
}

// Customer shoots from the last `days` days, newest first.
// Runs fn over items, `limit` at a time.
async function inBatches(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  return out;
}

export async function reviewShoots(days = 30, now = Date.now()) {
  const out = [];
  // Only the shoot records (small) are read for every shoot; the frames only
  // for shoots inside the window.
  const recent = (await inBatches(await allUsers(), 8, async (u) => {
    const ids = (await list(`idx/${u.id}/`)).map((k) => k.split("/").pop());
    const metas = await inBatches(ids, 8, (sid) => shoots.getMeta(sid).catch(() => null));
    return metas.filter((m) => m && !m.sample && now - Date.parse(m.createdAt || 0) <= days * DAY_MS).map((m) => ({ u, sid: m.id }));
  })).flat();
  const loaded = await inBatches(recent, 8, async ({ u, sid }) => ({ u, s: await shoots.get(sid).catch(() => null) }));
  for (const { u, s } of loaded) {
    {
      if (!s) continue;
      const done = s.shots.filter((t) => t.status === "done");
      const grades = done.map((t) => s.review?.shots?.[t.id]).filter(Boolean);
      const finishedAt = done.map((t) => Date.parse(t.finishedAt || 0)).filter(Boolean).sort().pop();
      out.push({
        id: s.id,
        createdAt: s.createdAt,
        email: mask(u.email),
        status: s.status,
        paidWith: s.paidWith || (s.team ? "team" : null),
        preview: isPreview(s, u),
        selfies: (s.selfies || []).length,
        checkScore: s.check?.overall_score ?? null,
        looks: (s.looks || []).length,
        frames: s.shots.length,
        done: done.length,
        failed: s.shots.filter((t) => t.status === "error").length,
        retakes: s.shots.reduce((n, t) => n + Math.max(0, (t.attempt || 1) - 1), 0),
        bestScore: grades.length ? Math.max(...grades.map((g) => g.overall)) : null,
        avgScore: avg(grades.map((g) => g.overall)),
        avgLikeness: grades.length ? +(grades.reduce((a, g) => a + (g.likeness || 0), 0) / grades.length).toFixed(1) : null,
        keepers: grades.filter((g) => g.grade === "keeper").length,
        minutes: finishedAt ? Math.round((finishedAt - Date.parse(s.createdAt)) / 60000) : null,
        downloaded: s.downloadedAt || null,
        bought: (u.purchases || []).length > 0,
        userId: u.id,
        reviewError: s.reviewError || null,
      });
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const freeShoots = out.filter((s) => s.paidWith === "free");
  return {
    shoots: out,
    summary: {
      shoots: out.length,
      free: freeShoots.length,
      freeFinished: freeShoots.filter((s) => s.status === "done").length,
      freeWithFailures: freeShoots.filter((s) => s.failed > 0).length,
      freeAvgBest: avg(freeShoots.map((s) => s.bestScore).filter((v) => v != null)),
      freeDownloaded: freeShoots.filter((s) => s.downloaded).length,
      buyers: new Set(out.filter((s) => s.bought).map((s) => s.userId)).size,
    },
  };
}

// Who an offer goes to: confirmed, reminders on, never bought, and either
// used the free shoot or confirmed and never developed one; not sent this
// code before.
export function offerFor(u, code) {
  if (!customer(u) || u.emailVerified === false || u.emailVerifiedVia === "invite" || u.remindersOff) return null;
  if ((u.purchases || []).length || (u.offers || {})[code]) return null;
  return { usedFree: !!u.usage?.freeShootUsed };
}

export async function offerRecipients(code) {
  return (await allUsers()).filter((u) => offerFor(u, code));
}

// Sends the offer. `dryRun` only counts. Returns { eligible, sent, failed, capped }.
export async function sendOffer({ code, discount, until, origin, dryRun = false }) {
  if (!CODE.test(code)) throw Object.assign(new Error("Use the promotion code exactly as it is in Stripe: letters and numbers, 3 to 31 characters."), { status: 400 });
  // Looked up first, so a typo can't go out to everyone (and burn the code's one send).
  if (!billingEnabled()) throw Object.assign(new Error("Payments aren't set up on this server, so the code can't be checked."), { status: 503 });
  const promo = await promotionCode(code).catch((err) => {
    throw Object.assign(new Error(`Stripe couldn't check that code: ${err.message}`), { status: 502 });
  });
  if (!promo) throw Object.assign(new Error(`Stripe has no active promotion code "${code}". Create it there first, or check the spelling.`), { status: 400, field: "code" });
  const people = await offerRecipients(code);
  const report = { eligible: people.length, sent: 0, failed: 0, capped: Math.max(0, people.length - OFFER_MAX_PER_RUN), promo };
  if (dryRun) return report;
  if (!mailEnabled()) throw Object.assign(new Error("Email isn't set up on this server."), { status: 503 });
  // Paced (the mail provider allows a few sends a second) and stopped well
  // inside the function's time limit; whoever is left gets it on the next send.
  const started = Date.now();
  for (const p of people.slice(0, OFFER_MAX_PER_RUN)) {
    if (Date.now() - started > SEND_BUDGET_MS) {
      report.stopped = "time";
      break;
    }
    // Record it first, so two sends can't both email the same person.
    let claimed = false;
    await users.update(p.id, (x) => {
      claimed = false;
      if (!offerFor(x, code)) return UNCHANGED;
      x.offers = { ...x.offers, [code]: new Date().toISOString() };
      claimed = true;
    });
    if (!claimed) continue;
    const metas = (await Promise.all((await list(`idx/${p.id}/`)).map((k) => shoots.getMeta(k.split("/").pop())))).filter(Boolean);
    const free = p.usage?.freeShootUsed && metas.find((m) => m.id === p.usage.freeShootUsed);
    // Photos uploaded and checked but never developed: send them back to that shoot.
    const checked = !p.usage?.freeShootUsed && metas.filter((m) => m.status === "checked" && !(m.shots || []).length).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
    const unsubscribe = `${origin}/unsubscribe?token=${unsubscribeToken(p.id)}`;
    const oneClick = `${origin}/api/unsubscribe?token=${unsubscribeToken(p.id)}`;
    const { subject, text, html } = offerEmail({
      name: p.name,
      code,
      discount,
      until,
      link: free ? `${origin}/app/shoot/${free.id}` : p.usage?.freeShootUsed ? `${origin}/app` : checked ? `${origin}/app/shoot/${checked.id}` : `${origin}/app/new`,
      pricing: `${origin}/#pricing`,
      usedFree: !!p.usage?.freeShootUsed,
      checked: !!checked,
      preview: !!free?.preview,
      unsubscribe,
    });
    try {
      await sendMail({ from: { name: "Keeper Headshots", address: MAIL_FROM }, to: p.email, subject, text, html, headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
      report.sent++;
      console.log("[offer] sent", code, p.id);
      await new Promise((r) => setTimeout(r, SEND_GAP_MS));
    } catch (err) {
      await users.update(p.id, (x) => {
        if (x.offers) delete x.offers[code];
      }).catch(() => {});
      report.failed++;
      console.error("[offer] send failed", p.id, err.message);
      // Rate-limited: the rest would fail too.
      if (/\b429\b|rate limit/i.test(err.message)) {
        report.stopped = "rate_limited";
        break;
      }
    }
  }
  return report;
}
