// Reminder emails, sent by the daily clean-up cron (lib/cleanup.js). Each
// account gets at most one of each kind, ever:
//
//   develop — photos checked (a photo check ran) but nothing developed yet,
//             1 to 14 days after the shoot was last touched.
//   checkout — started a checkout but didn't finish it (and has never
//             bought), 1 to 7 days later.
//   buy     — the free shoot is developed but nothing has been bought, 2 to 21
//             days after it finished.
//
// "checkout" and "buy" are both about buying, so an account gets only one of
// them: at most two reminders in all.
//
// Never sent to: unconfirmed addresses, the demo account, owners, anyone who
// has bought already (for "buy"), or anyone who turned reminders off (the
// unsubscribe link in every reminder, or the switch on the account page).
// At most REMINDERS_PER_DAY a day, so they can't use up the email allowance
// that confirmations and password resets need. A reminder is recorded on the
// account before it's sent, so two runs can't send it twice.

import crypto from "node:crypto";
import { list, getJSON, UNCHANGED } from "./storage.js";
import { users, shoots } from "./store.js";
import { planFor } from "./plan.js";
import { PACKAGES } from "../public/js/shared/catalog.js";
import { sendMail, mailEnabled, MAIL_FROM, reminderEmail } from "./mail.js";

export const REMINDERS_PER_DAY = Number(process.env.REMINDERS_PER_DAY || 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = { develop: [1, 14], checkout: [1, 7], buy: [2, 21] }; // days since the shoot was last touched

// Unsubscribe links: the account id, signed, so a link only ever turns off
// that one account's reminders.
const secret = () => process.env.SESSION_SECRET || "dev-only-secret";
const sig = (uid) => crypto.createHmac("sha256", secret()).update(`unsubscribe:${uid}`).digest("base64url").slice(0, 32);
export const unsubscribeToken = (uid) => `${uid}.${sig(uid)}`;
export function checkUnsubscribeToken(token) {
  const m = /^(usr_[\w-]+)\.([\w-]{32})$/.exec(String(token || ""));
  if (!m) return null;
  const expected = sig(m[1]);
  return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected)) ? m[1] : null;
}

const within = (iso, [from, to], now) => {
  const age = (now - Date.parse(iso || "")) / DAY_MS;
  return age >= from && age <= to;
};

// Which reminder (if any) this account is due, and the shoot it's about.
export async function dueReminder(u, now = Date.now()) {
  if (!u || u.demo || u.emailVerified === false || u.emailVerifiedVia === "invite" || u.remindersOff) return null;
  const plan = planFor(u);
  if (plan.tier === "owner") return null;
  const sent = u.reminders || {};

  const metas = (await Promise.all((await list(`idx/${u.id}/`)).map((k) => shoots.getMeta(k.split("/").pop())))).filter(Boolean);
  const developed = metas.some((m) => (m.shots || []).length);

  // Only if they can develop now (not, say, a used free shoot and no credits).
  if (!sent.develop && !developed && plan.canDevelop) {
    const checked = metas.filter((m) => m.status === "checked" && m.check).sort((a, b) => String(b.updatedAt || b.check.at).localeCompare(String(a.updatedAt || a.check.at)))[0];
    if (checked && within(checked.updatedAt || checked.check.at, WINDOWS.develop, now)) return { kind: "develop", shoot: checked };
  }
  const sold = sent.buy || sent.checkout || (u.purchases || []).length > 0;
  const pkg = PACKAGES.find((p) => p.id === u.lastCheckout?.packageId);
  if (!sold && pkg && within(u.lastCheckout.at, WINDOWS.checkout, now)) return { kind: "checkout", pkg };
  if (!sold && !(u.credits > 0) && u.usage?.freeShootUsed) {
    const free = metas.find((m) => m.id === u.usage.freeShootUsed);
    if (free?.status === "done" && within(free.updatedAt || free.createdAt, WINDOWS.buy, now)) return { kind: "buy", shoot: free };
  }
  return null;
}

// Goes through every account (resuming where the last run stopped) and sends
// what's due, up to the day's limit and the time budget.
export async function runReminders({ origin, now = Date.now(), deadline = Date.now() + 60_000, limit = REMINDERS_PER_DAY, state = {} } = {}) {
  const report = { checked: 0, sent: 0, failed: 0, finished: true };
  if (!mailEnabled()) return { ...report, skipped: "email not set up" };
  const ids = (await list("users/id/")).map((k) => k.split("/").pop().replace(/\.json$/, "")).sort();
  const start = state.cursor ? ids.findIndex((id) => id > state.cursor) : 0;
  const order = start > 0 ? [...ids.slice(start), ...ids.slice(0, start)] : ids;
  for (const uid of order) {
    if (report.sent >= limit || Date.now() > deadline) {
      report.finished = false;
      break;
    }
    state.cursor = uid;
    report.checked++;
    try {
      const u = await getJSON(`users/id/${uid}.json`);
      const due = await dueReminder(u, now);
      if (!due) continue;
      // Record it first: if another run got here in between, it wins.
      let claimed = false;
      await users.update(uid, (x) => {
        claimed = false; // storage may run this again after a conflicting write
        if (x.reminders?.[due.kind] || x.remindersOff) return UNCHANGED;
        x.reminders = { ...x.reminders, [due.kind]: new Date(now).toISOString() };
        claimed = true;
      });
      if (!claimed) continue;
      const unsubscribe = `${origin}/unsubscribe?token=${unsubscribeToken(uid)}`;
      const oneClick = `${origin}/api/unsubscribe?token=${unsubscribeToken(uid)}`;
      const link = due.kind === "checkout" ? `${origin}/app/buy/${due.pkg.id}` : `${origin}/app/shoot/${due.shoot.id}`;
      const { subject, text, html } = reminderEmail({ kind: due.kind, name: u.name, link, pricing: `${origin}/#pricing`, unsubscribe, pkg: due.pkg });
      try {
        await sendMail({
          from: { name: "Keeper Headshots", address: MAIL_FROM },
          to: u.email,
          subject,
          text,
          html,
          // One-click unsubscribe (RFC 8058), which Gmail and Yahoo expect.
          headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        report.sent++;
        console.log("[reminders] sent", due.kind, uid);
      } catch (err) {
        // Not sent: give the reminder back so tomorrow's run can try again.
        await users.update(uid, (x) => {
          if (x.reminders) delete x.reminders[due.kind];
        }).catch(() => {});
        report.failed++;
        console.error("[reminders] send failed", uid, err.message);
      }
    } catch (err) {
      report.failed++;
      console.error("[reminders]", uid, err.message);
    }
  }
  if (report.finished) state.cursor = null;
  return report;
}
