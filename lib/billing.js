// Stripe Checkout for one-time shoot packages.
//
// A purchase adds credits (one per shoot) to the buyer's account. Credits are
// granted from three places, all idempotent via a write-once record per
// Checkout Session:
//   1. confirm() — when the buyer lands back on the dashboard after paying
//   2. sync()    — on later dashboard visits, in case they closed the tab
//   3. the webhook, if STRIPE_WEBHOOK_SECRET is configured

import Stripe from "stripe";
import { users, shoots as shootStore, accountDeleting, id } from "./store.js";
import { mapLimit } from "./collections.js";
import { unlocksPreviews } from "./preview.js";
import * as showcase from "./showcase.js";
import * as teams from "./teams.js";
import { createJSON, getJSON, putJSON, updateJSON, del, UNCHANGED } from "./storage.js";
import { offerFor, isPreviewOffer, MAX_LOOKS } from "../public/js/shared/catalog.js";
import { track } from "./meta.js";
import { recordStep, recordRefund, reverseRefund } from "./stats.js";
import { creditLots } from "./plan.js";

let stripe;
const client = () => {
  if (stripe) return stripe;
  // STRIPE_API_BASE is only for local QA against scripts/dev/mock-ai.js.
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") } : {});
  return stripe;
};
// Live payments only on the live site; test-mode keys only on previews and
// local copies. A key in the wrong place turns payments off (and is logged
// once, which reaches the alert email) rather than taking a real card on a
// preview or a fake one on the live site.
const secretMode = () => (/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || "") ? "live" : "test");
const warned = new Set();
function keyAllowed() {
  const env = process.env.VERCEL_ENV;
  const ok = env === "production" ? secretMode() === "live" : env === "preview" ? secretMode() === "test" : true;
  if (!ok && !warned.has(`${env}:${secretMode()}`)) {
    warned.add(`${env}:${secretMode()}`);
    console.error(`[billing] a ${secretMode()}-mode Stripe key is set on ${env}; payments are off there`);
  }
  return ok;
}
export const billingEnabled = () => !!process.env.STRIPE_SECRET_KEY && keyAllowed();
export const stripeMode = () => (billingEnabled() ? secretMode() : null);

async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  // One customer per account even when two checkouts start at once: Stripe
  // returns the same customer for the same idempotency key, and the first
  // stored id wins.
  const customer = await client().customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } }, { idempotencyKey: `customer-${user.id}` });
  let stored = customer.id;
  await users.update(user.id, (u) => {
    if (!u.stripeCustomerId) u.stripeCustomerId = customer.id;
    stored = u.stripeCustomerId;
  });
  return stored;
}

// Stripe's publishable key (pk_...). It's public by design; when it's set,
// checkout is embedded in our own page instead of redirecting to Stripe.
// Only when it's the same mode as the secret key (else checkout uses Stripe's
// hosted page, which needs only the secret key).
export const stripePublishableKey = () => {
  const pk = process.env.STRIPE_PUBLISHABLE_KEY || "";
  const m = /^pk_(live|test)_\w+$/.exec(pk);
  return m && billingEnabled() && m[1] === secretMode() ? pk : null;
};

// embedded: Stripe's payment form inside our /app/buy page (returns a client
// secret for Stripe.js); otherwise Stripe's hosted page (returns its URL).
// Either way the customer comes back to /app?checkout=success, which confirms
// the payment and grants the shoots (the webhook does too).
//
// A preview offer (catalog PREVIEW_OFFERS) is bought for one free-preview
// shoot (`shootId`, checked by the caller): it unlocks that shoot and may add
// looks to it, and the buyer comes back to that shoot.
// The promotion code as Stripe knows it ({ code, percentOff, amountOff, expiresAt }), or null.
export async function promotionCode(code) {
  const page = await client().promotionCodes.list({ code, active: true, limit: 1 });
  const p = page.data?.[0];
  if (!p) return null;
  return { code: p.code, percentOff: p.coupon?.percent_off ?? null, amountOff: p.coupon?.amount_off ?? null, expiresAt: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null };
}

export async function createCheckout(user, packageId, origin, { gpc = false, embedded = false, shootId = null, shotId = null, toTeam = false, browser = {} } = {}) {
  const pkg = offerFor(packageId);
  if (!pkg) throw Object.assign(new Error("That package doesn't exist."), { status: 400 });
  const offer = isPreviewOffer(pkg.id);
  if (offer && !shootId) throw Object.assign(new Error("Choose the shoot to keep first."), { status: 400 });
  // A package bought from the team page goes back there.
  const back = offer ? `${origin}/app/shoot/${shootId}` : toTeam ? `${origin}/app/team` : `${origin}/app`;
  const customer = await ensureCustomer(user);
  const session = await client().checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(pkg.price * 100),
          product_data: { name: `Keeper Headshots — ${pkg.name}`, description: offer ? pkg.features.join(" · ") : `${pkg.shoots} headshot shoots (up to ${pkg.shoots * 8} headshots)` },
        },
      },
    ],
    metadata: { userId: user.id, packageId: pkg.id, shoots: String(pkg.shoots || 0), ...(offer ? { shootId, looks: String(pkg.looks || 0), ...(shotId ? { shotId } : {}) } : {}), ...(gpc ? { gpc: "1" } : {}),
      // The buyer's browser details (lib/meta.js browserDetails), for the
      // Purchase sent to Meta when the payment is confirmed.
      ...Object.fromEntries(Object.entries(browser).map(([k, v]) => [`meta_${k}`, v])) },
    // Promotion codes are created in the Stripe dashboard (Product catalog →
    // Coupons); the payment form shows an "Add promotion code" field.
    allow_promotion_codes: true,
    // An offer is for a preview as it is now: a page left open for a day
    // shouldn't take a payment after the shoot was unlocked another way.
    ...(offer ? { expires_at: Math.floor(Date.now() / 1000) + 60 * 60 } : {}),
    ...(embedded
      ? { ui_mode: "embedded_page", return_url: `${back}?checkout=success&session_id={CHECKOUT_SESSION_ID}` }
      : { success_url: `${back}?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${back}?checkout=cancelled` }),
  });
  return { url: session.url, clientSecret: session.client_secret || null, id: session.id, value: pkg.price };
}

// The browser details saved on the session at checkout (createCheckout).
const browserFrom = (md = {}) => ({ ip: md.meta_ip, ua: md.meta_ua, fbp: md.meta_fbp, fbc: md.meta_fbc });

// Paid, or complete with nothing to pay (a 100%-off promotion code).
const settled = (session) => session.payment_status === "paid" || (session.payment_status === "no_payment_required" && session.status === "complete");

// Grant a paid session exactly once: its shoot credits, or for a preview
// offer, the unlock (any purchase unlocks free previews: lib/preview.js) and
// extra looks for that shoot. Returns { shoots, granted } (nothing if unpaid
// or already granted).
const NONE = { shoots: 0, granted: false };
async function fulfil(session) {
  if (!settled(session)) return NONE;
  const userId = session.metadata?.userId || session.client_reference_id;
  const shoots = Number(session.metadata?.shoots || 0);
  const offer = isPreviewOffer(session.metadata?.packageId) ? { shootId: session.metadata?.shootId, shotId: session.metadata?.shotId || null, looks: Number(session.metadata?.looks || 0) } : null;
  if (!userId || (!shoots && !offer?.shootId)) return NONE;
  const key = `payments/${session.id}.json`;
  await createJSON(key, {
    sessionId: session.id,
    userId,
    packageId: session.metadata?.packageId,
    shoots,
    amount: session.amount_total,
    discount: session.total_details?.amount_discount || 0,
    currency: session.currency,
    at: new Date().toISOString(),
    ...(offer ? { shootId: offer.shootId, looks: offer.looks, ...(offer.shotId ? { shotId: offer.shotId } : {}) } : {}),
    granted: false,
  });
  // The record exists now (from this call or an earlier one). Grant unless it
  // says it's done; the grant itself is idempotent on the user's purchase list,
  // so a crash between the two writes is repaired by the next webhook/confirm/sync.
  if ((await getJSON(key))?.granted) return NONE;
  let granted = false;
  let redundant = "";
  // A preview offer for a shoot that's gone (deleted while checkout was open)
  // buys nothing: recorded, nothing attached to the missing shoot, flagged.
  const offerShoot = offer ? await shootStore.getMeta(offer.shootId).catch(() => true) : null;
  const shootGone = !!offer && !offerShoot;
  const user = await users.update(userId, (u) => {
    granted = false;
    redundant = "";
    if ((u.purchases || []).some((p) => p.sessionId === session.id)) return;
    // Paid twice (two tabs, or Back during checkout) for something the
    // account already had: still recorded, but flagged for a refund below.
    if (shootGone) redundant = "its shoot was deleted";
    // ("Keep all + 2 more looks" still adds its looks, so it isn't flagged,
    // unless the shoot has no room left for them.)
    else if (offer && !offer.looks && unlocksPreviews(u)) redundant = "the previews were already unlocked";
    else if (offer?.looks && Array.isArray(offerShoot?.looks) && offerShoot.looks.length + (u.extraLooks?.[offer.shootId] || 0) + offer.looks > MAX_LOOKS) redundant = "its shoot already has every look it can take";
    else if (offer?.shotId && (u.kept?.[offer.shootId] || []).includes(offer.shotId)) redundant = "that headshot was already kept";
    const settle = Math.min(u.creditsOwed || 0, shoots);
    if (settle) u.creditsOwed -= settle;
    if (!u.creditsOwed) delete u.creditsOwed;
    u.credits = (u.credits || 0) + shoots - settle;
    // "Keep your pick": that one headshot is unlocked (lib/preview.js).
    if (offer?.shotId && !shootGone) u.kept = { ...u.kept, [offer.shootId]: [...new Set([...(u.kept?.[offer.shootId] || []), offer.shotId])] };
    if (offer?.looks && !shootGone) u.extraLooks = { ...u.extraLooks, [offer.shootId]: (u.extraLooks?.[offer.shootId] || 0) + offer.looks };
    u.purchases = [...(u.purchases || []), { sessionId: session.id, packageId: session.metadata?.packageId, shoots, ...(offer ? { shootId: offer.shootId, looks: offer.looks, ...(offer.shotId ? { shotId: offer.shotId } : {}) } : {}), amount: session.amount_total, ...(session.total_details?.amount_discount ? { discount: session.total_details.amount_discount } : {}), at: new Date().toISOString() }];
    granted = true;
  }).catch((err) => (err.status === 410 ? null : Promise.reject(err))); // deleted (or being deleted)
  if (!user) {
    // Paid, but there's no account to give it to: flagged for a refund.
    console.error(`[billing] payment ${session.id} (${session.metadata?.packageId}, ${(session.amount_total || 0) / 100}) for missing user ${userId} may need a refund: the account was deleted`);
    await updateJSON(key, (rec) => (rec.orphaned ? UNCHANGED : { ...rec, orphaned: true })).catch(() => {});
    return NONE;
  }
  // Logged as an error, so the owner is emailed to refund it.
  if (granted && redundant) console.error(`[billing] payment ${session.id} (${session.metadata?.packageId}, $${(session.amount_total || 0) / 100}) for user ${userId} may need a refund: ${redundant}`);
  // revenueCounted says the funnel booked this sale, so a refund of it is
  // only subtracted from revenue that was added (older records predate it).
  await updateJSON(key, (rec) => ({ ...rec, granted: true, grantedAt: rec.grantedAt || new Date().toISOString(), ...(granted && session.amount_total > 0 ? { revenueCounted: false } : {}) }));
  // A free (100%-off) order isn't a sale for the funnel either.
  if (granted && session.amount_total > 0) {
    const booked = await recordStep("purchase", user, { amount: session.amount_total, first: (user.purchases || []).filter((p) => p.amount == null || p.amount > 0).length === 1 }).then(() => true, (err) => (console.warn("[stats]", err.message), false));
    if (booked) await updateJSON(key, (rec) => ({ ...rec, revenueCounted: true })).catch(() => {});
  }
  // A free (100%-off) order isn't a sale for ad measurement.
  if (granted && session.amount_total > 0) track("Purchase", { eventId: `purchase_${session.id}`, user, value: (session.amount_total || 0) / 100, currency: (session.currency || "usd").toUpperCase(), url: "https://keeperheadshots.com/app", browser: browserFrom(session.metadata), optOut: session.metadata?.gpc === "1" });
  return granted ? { shoots, granted } : NONE;
}

export async function confirm(user, sessionId) {
  const session = await client().checkout.sessions.retrieve(String(sessionId));
  const owner = session.metadata?.userId || session.client_reference_id;
  if (owner !== user.id) throw Object.assign(new Error("That purchase belongs to a different account."), { status: 403 });
  const { shoots: added, granted } = await fulfil(session);
  // Lets the browser Pixel send the matching Purchase (same event_id) once.
  // The event id lets the browser Pixel send the matching Purchase; Meta
  // de-duplicates on it, so it's fine to return it for any paid session.
  const paid = settled(session);
  // When this call didn't grant it, when it was granted (so a success page
  // opened again later can say "already applied" rather than "added").
  const appliedAt = paid && !granted ? (await getJSON(`payments/${session.id}.json`))?.grantedAt || null : null;
  return { added, granted, packageId: session.metadata?.packageId || null, paid, ...(appliedAt ? { appliedAt } : {}), ...(paid && session.amount_total > 0 ? { eventId: `purchase_${session.id}`, value: session.amount_total / 100 } : {}) };
}

// Refunds are issued in the Stripe dashboard. For a credited session whose
// charge has been refunded (fully, or partly for a pro-rata refund), remove
// the matching share of that package's shoots, once.
// A dispute (chargeback) counts as a full refund of the disputed amount.
// A fully refunded preview offer or package (a partial, goodwill refund
// leaves it in place) also
// stops counting as a purchase: it no longer unlocks free previews
// (lib/preview.js), the headshot it kept goes back to a preview and its
// unused extra looks are removed.
async function reconcileRefund(session, { disputed = 0 } = {}) {
  const charge = session.payment_intent?.latest_charge;
  const none = { removed: 0, revoked: false };
  if (!charge || typeof charge !== "object") return none;
  // A dispute over what's left after a partial refund adds to it.
  const refunded = Math.min(charge.amount || Infinity, (charge.amount_refunded || 0) + disputed);
  if (!refunded) return none;
  const credited = await getJSON(`payments/${session.id}.json`);
  if (!credited) return none;
  // A dispute we've since won isn't taken again (a late or repeated event),
  // nor booked as a refund again.
  if (disputed && credited.disputesWon?.length) return none;
  // The funnel's refunds (counted once per amount, however often this runs).
  // (An account deleted since is still a customer's refund: counted from the payment record.)
  // Only a sale the funnel booked: not an orphaned payment (no account to
  // grant it to) or one whose booking failed.
  const booked = credited.revenueCounted ?? (credited.granted && !credited.orphaned);
  if (credited.amount > 0 && booked) await users.byId(credited.userId).then((u) => recordRefund(u || { id: credited.userId }, session.id, Math.min(refunded, credited.amount))).catch((err) => console.error("[stats] refund", session.id, err.message));
  // Whole shoots only, in cents: k shoots come back once the refund reaches
  // k shoots' share of the price, rounded down to the cent (so $9.66 of a
  // $29, 3-shoot package is one shoot, $19.33 two, and $9.19 none).
  const paid = charge.amount || credited.amount || 1;
  let target = 0;
  while (target < credited.shoots && refunded >= Math.floor(((target + 1) * paid) / credited.shoots)) target++;
  const revoke = refunded >= (charge.amount || credited.amount || 1);
  // Decide and apply the deduction inside one atomic update of the user, based
  // on what this session has already had removed, so concurrent syncs can't
  // deduct twice.
  // Only credits sitting on team seats can go into debt; credits spent on
  // developed shoots are gone, which the refund amount already allows for.
  // (Only the seats this package paid for: another package's seats are its own.)
  const seatsOnCredit = await teams.seatsOnCredit(credited.userId, session.id).catch(() => 0);
  let delta = 0;
  let ownerGone = false;
  let revoked = false;
  let shotRevoked = false;
  let owedAfter = 0;
  let excess = 0;
  let creditsTaken = 0;
  let owedAdded = 0;
  // This refund's own entry (below): a later update finds it by id, not by
  // payment, which a chargeback of the same payment shares.
  const entryId = id("rfd");
  await users.update(credited.userId, (u) => {
    delta = 0;
    revoked = false;
    shotRevoked = false;
    owedAfter = 0;
    excess = 0;
    creditsTaken = 0;
    owedAdded = 0;
    // A dispute we've since won isn't taken again (a late or repeated event).
    if (disputed && (u.refunds || []).some((r) => r.sessionId === session.id && r.disputeWon)) return UNCHANGED;
    const prior = (u.refunds || []).filter((r) => r.sessionId === session.id).reduce((n, r) => n + (r.shootsRemoved || 0), 0);
    const purchase = (u.purchases || []).find((p) => p.sessionId === session.id);
    delta = Math.max(0, target - prior);
    revoked = revoke && !!purchase && !purchase.refunded;
    if (!delta && !revoked) return UNCHANGED;
    if (delta) {
      // Credits already spent on team seats can't be taken back now; a seat
      // returned later (lib/teams.js release) settles the debt first.
      // Only this package's own unused credits come back off the balance,
      // never another package's (lib/plan.js creditLots).
      const lot = creditLots(u).left.get(session.id);
      const have = Math.min(u.credits || 0, lot ?? (u.credits || 0));
      const take = Math.min(have, delta);
      u.credits = Math.max(0, (u.credits || 0) - take);
      creditsTaken = take;
      excess = delta - take;
      owedAdded = excess > 0 ? Math.min(excess, seatsOnCredit) : 0;
      if (owedAdded) u.creditsOwed = (u.creditsOwed || 0) + owedAdded;
      if (!u.creditsOwed) delete u.creditsOwed;
      owedAfter = u.creditsOwed || 0;
    }
    if (revoked) {
      purchase.refunded = true;
      const sid = credited.shootId;
      const stillPaid = (u.purchases || []).some((p) => p !== purchase && !p.refunded && p.shootId === sid && p.shotId === credited.shotId);
      if (sid && credited.shotId && u.kept?.[sid] && !stillPaid) {
        shotRevoked = true;
        u.kept = { ...u.kept, [sid]: u.kept[sid].filter((id) => id !== credited.shotId) };
        if (!u.kept[sid].length) delete u.kept[sid];
      }
      if (sid && credited.looks && u.extraLooks?.[sid]) {
        u.extraLooks = { ...u.extraLooks, [sid]: Math.max(0, u.extraLooks[sid] - credited.looks) };
        if (!u.extraLooks[sid]) delete u.extraLooks[sid];
      }
    }
    // creditsTaken and owedAdded are what actually came off the account (the
    // rest of shootsRemoved was already spent): what a won dispute gives back.
    u.refunds = [...(u.refunds || []), { id: entryId, sessionId: session.id, shootsRemoved: delta, creditsTaken, owedAdded, ...(revoked ? { revoked: true } : {}), amountRefunded: refunded, ...(disputed ? { disputed: true } : {}), at: new Date().toISOString() }];
  }).catch((err) => {
    if (err.status !== 410) throw err;
    // The account was deleted: nothing left to take back (a retry can't change that).
    console.warn(`[billing] refund ${session.id} for deleted user ${credited.userId}: nothing to take back`);
    delta = 0;
    revoked = false;
    ownerGone = true;
  });
  // Seats this package paid for on a deleted admin's team aren't paid for now.
  // A storage failure must reach the webhook handler so Stripe retries the
  // pending seat changes instead of accepting an incomplete refund update.
  if (ownerGone) await teams.unpaySeatsOfGoneOwner(credited.userId, session.id, target);
  if (!delta && !revoked) return { removed: 0, revoked: false };
  // A seat charged while this ran (an invite sent at the same moment) wasn't
  // in the count above: count again, and add what the debt is short.
  if (excess > 0) {
    const later = await teams.seatsOnCredit(credited.userId, session.id).catch(() => seatsOnCredit);
    const extra = Math.min(excess, later) - Math.min(excess, seatsOnCredit);
    if (extra > 0) {
      const u2 = await users.update(credited.userId, (u) => {
        u.creditsOwed = (u.creditsOwed || 0) + extra;
        // On this refund's entry too, so a chargeback we win gives it back.
        const entry = (u.refunds || []).find((r) => r.id === entryId);
        if (entry) entry.owedAdded = (entry.owedAdded || 0) + extra;
      }).catch(() => null);
      if (u2) owedAfter = u2.creditsOwed || 0;
    }
  }
  if (shotRevoked) await showcase.removeForShot(credited.userId, credited.shootId, credited.shotId).catch((err) => console.error("[billing] showcase cleanup", session.id, err.message));
  else if (revoked) {
    await showcase.removeLocked(credited.userId).catch((err) => console.error("[billing] showcase cleanup", session.id, err.message));
    if (credited.shoots) {
      await showcase.removeForRefund(credited.userId, session.id).catch((err) => console.error("[billing] showcase cleanup", session.id, err.message));
      await showcase.removeForTeamRefund(credited.userId, session.id).catch((err) => console.error("[billing] showcase cleanup", session.id, err.message));
    }
  }
  // Seats the refund unpaid: open invitations are withdrawn; seats already
  // taken are reported, since the owner may need to follow up.
  if (owedAfter > 0) {
    const withdrawn = await teams.settleDebt(credited.userId, session.id).catch((err) => (console.error("[billing] seat settle", session.id, err.message), 0));
    if (owedAfter - withdrawn > 0) console.error(`[billing] refund ${session.id}: ${owedAfter - withdrawn} team seat(s) for user ${credited.userId} are taken but no longer paid for`);
  }
  await putJSON(`refunds/${session.id}.json`, { sessionId: session.id, userId: credited.userId, removed: target, ...(revoked ? { revoked: true } : {}), amountRefunded: refunded, ...(disputed ? { disputed: true } : {}), at: new Date().toISOString() });
  return { removed: delta, revoked };
}

// Returns { added, removed } shoot credits, and revoked: purchases refunded
// since the last check.
export async function sync(user, { automatic = false } = {}) {
  const empty = { added: 0, removed: 0, revoked: 0 };
  if (!user.stripeCustomerId || await accountDeleting(user.id)) return empty;
  const key = `billing-sync/${user.id}.json`;
  if (!await getJSON(key)) await createJSON(key, { leaseUntil: 0, nextAutoAt: 0, historyCursor: null });
  const token = id("sync");
  let claimed = false;
  const state = await updateJSON(key, (s) => {
    claimed = false;
    if (s.leaseUntil > Date.now() || (automatic && s.nextAutoAt > Date.now())) return UNCHANGED;
    claimed = true;
    return { ...s, token, leaseUntil: Date.now() + 300_000 };
  });
  let complete = false;
  let historyCursor = state?.historyCursor || null;
  try {
    if (await accountDeleting(user.id)) { await del(key); return empty; }
    if (!claimed || !state) return empty;
    const options = { customer: user.stripeCustomerId, limit: 50, expand: ["data.payment_intent.latest_charge"] };
    // Check recent purchases every pass, plus one rotating history page.
    // Refund webhooks remain immediate; old purchases are revisited across
    // passes without making each dashboard visit walk up to 500 sessions.
    const recent = await client().checkout.sessions.list(options);
    let history = null;
    if (recent.has_more && recent.data.length) {
      const after = historyCursor || recent.data.at(-1).id;
      history = await client().checkout.sessions.list({ ...options, starting_after: after });
    }
    const sessions = [...new Map([...recent.data, ...(history?.data || [])].map((s) => [s.id, s])).values()];
    let refundsOk = true;
    const results = await mapLimit(sessions, 4, async (s) => {
      if (await accountDeleting(user.id)) return empty;
      const added = (await fulfil(s)).shoots;
      const refund = await reconcileRefund(s).catch((err) => {
        refundsOk = false;
        console.error("[billing] refund check", s.id, err.message);
        return { removed: 0, revoked: false };
      });
      return { added, removed: refund.removed, revoked: refund.revoked ? 1 : 0 };
    });
    if (refundsOk) historyCursor = history?.has_more && history.data.length ? history.data.at(-1).id : null;
    complete = refundsOk;
    return results.reduce((sum, r) => ({ added: sum.added + r.added, removed: sum.removed + r.removed, revoked: sum.revoked + r.revoked }), empty);
  } finally {
    if (claimed) await updateJSON(key, (s) => s.token !== token ? UNCHANGED : {
      ...s, leaseUntil: 0, historyCursor,
      nextAutoAt: complete ? Date.now() + 60_000 : 0,
    });
    if (await accountDeleting(user.id)) await del(key);
  }
}

// A chargeback we won gives back what the dispute took (reconcileRefund):
// the shoots, and for a fully disputed purchase, the purchase itself with its
// kept headshot and extra looks. Once per dispute.
async function restoreDispute(session, amount = 0, disputeId = "") {
  const credited = await getJSON(`payments/${session.id}.json`);
  if (!credited) return { restored: 0 };
  // Marked on the payment first, so a late or repeated dispute event for it
  // takes nothing and books nothing (reconcileRefund).
  await updateJSON(`payments/${session.id}.json`, (rec) => ((rec.disputesWon || []).includes(disputeId || "won") ? UNCHANGED : { ...rec, disputesWon: [...(rec.disputesWon || []), disputeId || "won"] }));
  let restored = 0;
  let unrevoked = false;
  await users.update(credited.userId, (u) => {
    restored = 0;
    unrevoked = false;
    const lost = (u.refunds || []).filter((r) => r.sessionId === session.id && r.disputed && !r.disputeWon);
    if (!lost.length) return UNCHANGED;
    // Only what actually came off the account: credits taken plus debt added
    // (shoots already spent before the dispute were never taken back).
    // Older entries don't record it: their shootsRemoved, as before.
    restored = lost.reduce((n, r) => n + (r.creditsTaken === undefined ? r.shootsRemoved || 0 : r.creditsTaken + (r.owedAdded || 0)), 0);
    const at = new Date().toISOString();
    u.refunds = u.refunds.map((r) => (lost.includes(r) ? { ...r, shootsRemoved: 0, shootsRestored: r.shootsRemoved || 0, disputeWon: at } : r));
    // Shoots the dispute left owing (spent on team seats) are settled first.
    const settle = Math.min(u.creditsOwed || 0, restored);
    if (settle) u.creditsOwed -= settle;
    if (!u.creditsOwed) delete u.creditsOwed;
    u.credits = (u.credits || 0) + restored - settle;
    const purchase = (u.purchases || []).find((p) => p.sessionId === session.id);
    if (purchase?.refunded && lost.some((r) => r.revoked)) {
      unrevoked = true;
      delete purchase.refunded;
      const sid = credited.shootId;
      if (sid && credited.shotId) u.kept = { ...u.kept, [sid]: [...new Set([...(u.kept?.[sid] || []), credited.shotId])] };
      if (sid && credited.looks) u.extraLooks = { ...u.extraLooks, [sid]: (u.extraLooks?.[sid] || 0) + credited.looks };
    }
  }).catch((err) => (err.status === 410 ? null : Promise.reject(err)));
  // Off the funnel's refund total too (once per dispute, even one too small to
  // have taken a shoot). Only the dispute's share: an ordinary refund of the
  // same payment (the charge's amount_refunded) stays a refund, and a dispute
  // won before its chargeback was ever booked takes nothing off.
  const charge = session.payment_intent?.latest_charge;
  const ordinary = (charge && typeof charge === "object" && charge.amount_refunded) || 0;
  await reverseRefund(session.id, amount, disputeId, ordinary).catch((err) => console.error("[stats] dispute won", session.id, err.message));
  if (restored || unrevoked) console.log(`[billing] dispute won for ${session.id}: ${restored} shoot(s) back${unrevoked ? ", purchase restored" : ""} for user ${credited.userId}`);
  return { restored, unrevoked };
}

const sessionFor = async (paymentIntent) =>
  (await client().checkout.sessions.list({ payment_intent: String(paymentIntent), limit: 1, expand: ["data.payment_intent.latest_charge"] })).data[0];

export async function handleWebhook(rawBody, signature) {
  const event = client().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await fulfil(event.data.object);
  }
  // Refunds and chargebacks take the matching shoots back straight away,
  // rather than waiting for the buyer's next visit (sync). An inquiry (a
  // dispute whose status starts "warning_") moves no money, so it takes
  // nothing; if it becomes a chargeback, the money leaving (funds_withdrawn)
  // takes the shoots then.
  const obj = event.data.object;
  const inquiry = String(obj?.status || "").startsWith("warning_");
  const disputeTakes = (event.type === "charge.dispute.created" && !inquiry) || event.type === "charge.dispute.funds_withdrawn";
  if (event.type === "charge.refunded" || disputeTakes) {
    if (!obj.payment_intent) return;
    const session = await sessionFor(obj.payment_intent);
    if (session) await reconcileRefund(session, { disputed: disputeTakes ? obj.amount || 0 : 0 });
  }
  // A chargeback we won: the money came back, and so does what it took.
  const won = (event.type === "charge.dispute.closed" && obj.status === "won") || event.type === "charge.dispute.funds_reinstated";
  if (won && obj.payment_intent) {
    const session = await sessionFor(obj.payment_intent);
    if (session) await restoreDispute(session, obj.amount || 0, obj.id || "");
  }
}
