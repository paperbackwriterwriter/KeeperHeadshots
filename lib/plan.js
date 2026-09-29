// What an account may do, based on credits and usage. Enforced on the server;
// the browser only uses it to explain limits before someone hits them.
//
//   owner  — emails in OWNER_EMAILS: no limits (for the site owner's testing)
//   demo   — the shared demo account: read-only
//   paid   — has credits: each developed shoot uses one credit
//   trial  — one free shoot, up to FREE.looks looks, once the email address
//            is confirmed (needsEmail until then)
//   none   — free shoot used, no credits

import { MAX_LOOKS } from "../public/js/shared/catalog.js";

export const FREE = { looks: 2, checks: 6, regradesPerShoot: 2 };

const owners = () =>
  (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function planFor(user) {
  const usage = user.usage || {};
  const credits = user.credits || 0;
  const freeShootAvailable = !usage.freeShootUsed;
  // Accounts created before email confirmation existed have no flag and count as confirmed.
  const emailVerified = user.emailVerified !== false;
  // Confirmed by the person (link or code), not only by accepting a team
  // invitation (see ownsMailbox in lib/auth.js).
  const ownsMailbox = emailVerified && user.emailVerifiedVia !== "invite";
  if (user.demo) return { tier: "demo", credits: 0, canDevelop: false, maxLooks: 0, freeShootAvailable: false, checksLeft: 0 };
  // Owner access needs a confirmed address, so nobody can claim an unused owner email.
  if (ownsMailbox && owners().includes(user.email)) return { tier: "owner", credits, canDevelop: true, maxLooks: MAX_LOOKS, freeShootAvailable, checksLeft: null };
  if (credits > 0) return { tier: "paid", credits, canDevelop: true, maxLooks: MAX_LOOKS, freeShootAvailable, checksLeft: null };
  return {
    tier: freeShootAvailable ? "trial" : "none",
    credits: 0,
    canDevelop: freeShootAvailable && ownsMailbox,
    needsEmail: freeShootAvailable && !ownsMailbox,
    maxLooks: freeShootAvailable ? FREE.looks : 0,
    freeShootAvailable,
    checksLeft: emailVerified ? Math.max(0, FREE.checks - (usage.checks || 0)) : 0,
  };
}

export class PlanError extends Error {
  constructor(message, code = "payment_required", status = 402) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const DEMO_READ_ONLY = "The demo account is read-only. Create a free account to try it with your own photos — your first shoot is free.";
export const NO_SHOOTS_LEFT = "You're out of shoots. Buy a package to develop more.";
export const EMAIL_UNCONFIRMED = "Confirm your email address to unlock your free shoot. We sent you a link when you signed up.";
