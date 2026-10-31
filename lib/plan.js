// What an account may do, based on credits and usage. Enforced on the server;
// the browser only uses it to explain limits before someone hits them.
//
//   owner  — emails in OWNER_EMAILS: no limits (for the site owner's testing)
//   demo   — the shared demo account: read-only
//   paid   — has credits: each developed shoot uses one credit
//   trial  — one free shoot, up to FREE.looks looks, once the email address
//            is confirmed (needsEmail until then). Only while
//            FREE_SHOOT_OFFERED: customers now pay up front.
//   none   — no credits (and no free shoot on offer, or it's used): buy a
//            package first. `started` tells a brand-new customer (never
//            bought, never had a free shoot) from one who has used theirs up.

import { MAX_LOOKS } from "../public/js/shared/catalog.js";

// checks: free photo checks per mailbox. Once they're used, a mailbox that
// hasn't had its free shoot yet can still check photos, up to
// checksPerDayBeforeShoot a day, so nobody is stuck before seeing a result.
// Whether new free (preview) shoots are offered. Off: every shoot is paid for
// up front (a package), and the free shoot's code paths below and in
// server.js stay in place but can't be reached. Previews people already have
// are unaffected (lib/preview.js). The test suites for the free preview turn
// it back on with FREE_SHOOT_OFFERED=1 (scripts/dev/ci.sh); production never
// sets that.
export const FREE_SHOOT_OFFERED = false;
export const freeShootOffered = () => FREE_SHOOT_OFFERED || process.env.FREE_SHOOT_OFFERED === "1";

export const FREE = { looks: 2, checks: 6, checksPerDayBeforeShoot: 10, regradesPerShoot: 2 };

const owners = () =>
  (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// Which package a credit spent now comes from, so a refund of one package
// only affects what that package paid for (lib/showcase.js). The balance is
// assigned to the newest live packages first, so credits are spent oldest
// package first. Returns its checkout session id, or null (credits from
// elsewhere, such as a returned team seat on an account with no package).
export function creditSource(u) {
  const { lots, left } = creditLots(u);
  return lots.find((l) => left.get(l.sid) > 0)?.sid || null;
}
// The account's live packages, oldest first, and how many of the balance's
// credits each still holds (newest packages first).
export function creditLots(u) {
  const removed = {};
  for (const r of u.refunds || []) removed[r.sessionId] = (removed[r.sessionId] || 0) + (r.shootsRemoved || 0);
  const lots = (u.purchases || [])
    .filter((p) => !p.refunded && p.shoots > 0)
    .map((p) => ({ sid: p.sessionId, size: Math.max(0, p.shoots - (removed[p.sessionId] || 0)), at: String(p.at || "") }))
    .sort((a, b) => a.at.localeCompare(b.at));
  let balance = u.credits || 0;
  const left = new Map();
  for (let i = lots.length - 1; i >= 0; i--) {
    const n = Math.min(lots[i].size, balance);
    left.set(lots[i].sid, n);
    balance -= n;
  }
  return { lots, left };
}

export const ownerEmail = (email) => owners().includes(String(email || "").trim().toLowerCase());

export function planFor(user) {
  const usage = user.usage || {};
  const credits = user.credits || 0;
  const freeShootAvailable = freeShootOffered() && !usage.freeShootUsed;
  // Has bought something or had a free shoot: "out of shoots", not "new here".
  const started = !!usage.freeShootUsed || (user.purchases || []).length > 0 || !!user.teamId;
  // Accounts created before email confirmation existed have no flag and count as confirmed.
  const emailVerified = user.emailVerified !== false;
  // Confirmed by the person (link or code), not only by accepting a team
  // invitation (see ownsMailbox in lib/auth.js).
  const ownsMailbox = emailVerified && user.emailVerifiedVia !== "invite";
  if (user.demo) return { tier: "demo", credits: 0, canDevelop: false, maxLooks: 0, freeShootAvailable: false, checksLeft: 0, started: false };
  // Owner access needs a confirmed address, so nobody can claim an unused owner email.
  if (ownsMailbox && owners().includes(user.email)) return { tier: "owner", credits, canDevelop: true, maxLooks: MAX_LOOKS, freeShootAvailable, checksLeft: null, started: true };
  // returning: has developed a shoot before (the dashboard's "next shoot").
  if (credits > 0) return { tier: "paid", credits, canDevelop: true, maxLooks: MAX_LOOKS, freeShootAvailable, checksLeft: null, started: true, returning: !!user.developed };
  return {
    tier: freeShootAvailable ? "trial" : "none",
    credits: 0,
    canDevelop: freeShootAvailable && ownsMailbox,
    needsEmail: freeShootAvailable && !ownsMailbox,
    maxLooks: freeShootAvailable ? FREE.looks : 0,
    freeShootAvailable,
    checksLeft: emailVerified ? Math.max(0, FREE.checks - (usage.checks || 0)) : 0,
    started,
    // Joined a team: their team shoot is paid for, more of their own aren't.
    // (Not once that shoot was deleted undeveloped and the seat went back.)
    teamMember: !!user.joinedTeam && user.teamSeatReturned !== user.joinedTeam,
  };
}

export class PlanError extends Error {
  constructor(message, code = "payment_required", status = 402) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const DEMO_READ_ONLY = "The demo account is read-only. Create an account and choose a package to use your own photos.";
export const NO_SHOOTS_LEFT = "You're out of shoots. Buy a package to develop more.";
// For an account that has never had a shoot (customers pay up front).
export const CHOOSE_PACKAGE = "Choose a package to start your first shoot. Your first package is covered by our money-back guarantee.";
// Only reached while a free shoot is on offer (needsEmail).
export const EMAIL_UNCONFIRMED = "Confirm your email address to unlock your free shoot. We sent you a link when you signed up.";
