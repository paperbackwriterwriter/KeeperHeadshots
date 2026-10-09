// Stripe Checkout for one-time shoot packages.
//
// A purchase adds credits (one per shoot) to the buyer's account. Credits are
// granted from three places, all idempotent via a write-once record per
// Checkout Session:
//   1. confirm() — when the buyer lands back on the dashboard after paying
//   2. sync()    — on later dashboard visits, in case they closed the tab
//   3. the webhook, if STRIPE_WEBHOOK_SECRET is configured

import Stripe from "stripe";
import { users, shoots as shootStore } from "./store.js";
import { unlocksPreviews } from "./preview.js";
import * as showcase from "./showcase.js";
import { createJSON, getJSON, putJSON, updateJSON, UNCHANGED } from "./storage.js";
import { offerFor, isPreviewOffer } from "../public/js/shared/catalog.js";
import { track } from "./meta.js";
import { recordStep } from "./stats.js";

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
export async function createCheckout(user, packageId, origin, { gpc = false, embedded = false, shootId = null, shotId = null } = {}) {
  const pkg = offerFor(packageId);
  if (!pkg) throw Object.assign(new Error("That package doesn't exist."), { status: 400 });
  const offer = isPreviewOffer(pkg.id);
  if (offer && !shootId) throw Object.assign(new Error("Choose the shoot to keep first."), { status: 400 });
  const back = offer ? `${origin}/app/shoot/${shootId}` : `${origin}/app`;
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
    metadata: { userId: user.id, packageId: pkg.id, shoots: String(pkg.shoots || 0), ...(offer ? { shootId, looks: String(pkg.looks || 0), ...(shotId ? { shotId } : {}) } : {}), ...(gpc ? { gpc: "1" } : {}) },
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
  const shootGone = !!offer && !(await shootStore.getMeta(offer.shootId).catch(() => true));
  const user = await users.update(userId, (u) => {
    granted = false;
    redundant = "";
    if ((u.purchases || []).some((p) => p.sessionId === session.id)) return;
    // Paid twice (two tabs, or Back during checkout) for something the
    // account already had: still recorded, but flagged for a refund below.
    if (shootGone) redundant = "its shoot was deleted";
    else if (offer && unlocksPreviews(u)) redundant = "the previews were already unlocked";
    else if (offer?.shotId && (u.kept?.[offer.shootId] || []).includes(offer.shotId)) redundant = "that headshot was already kept";
    u.credits = (u.credits || 0) + shoots;
    // "Keep your pick": that one headshot is unlocked (lib/preview.js).
    if (offer?.shotId && !shootGone) u.kept = { ...u.kept, [offer.shootId]: [...new Set([...(u.kept?.[offer.shootId] || []), offer.shotId])] };
    if (offer?.looks && !shootGone) u.extraLooks = { ...u.extraLooks, [offer.shootId]: (u.extraLooks?.[offer.shootId] || 0) + offer.looks };
    u.purchases = [...(u.purchases || []), { sessionId: session.id, packageId: session.metadata?.packageId, shoots, ...(offer ? { shootId: offer.shootId, looks: offer.looks, ...(offer.shotId ? { shotId: offer.shotId } : {}) } : {}), amount: session.amount_total, ...(session.total_details?.amount_discount ? { discount: session.total_details.amount_discount } : {}), at: new Date().toISOString() }];
    granted = true;
  });
  if (!user) return NONE;
  // Logged as an error, so the owner is emailed to refund it.
  if (granted && redundant) console.error(`[billing] payment ${session.id} (${session.metadata?.packageId}, $${(session.amount_total || 0) / 100}) for user ${userId} may need a refund: ${redundant}`);
  await updateJSON(key, (rec) => ({ ...rec, granted: true, grantedAt: rec.grantedAt || new Date().toISOString() }));
  if (granted) await recordStep("purchase", user, { amount: session.amount_total || 0, first: (user.purchases || []).length === 1 }).catch((err) => console.warn("[stats]", err.message));
  // A free (100%-off) order isn't a sale for ad measurement.
  if (granted && session.amount_total > 0) track("Purchase", { eventId: `purchase_${session.id}`, user, value: (session.amount_total || 0) / 100, currency: (session.currency || "usd").toUpperCase(), url: "https://keeperheadshots.com/app", optOut: session.metadata?.gpc === "1" });
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
  const target = Math.min(credited.shoots, Math.round((credited.shoots * refunded) / (charge.amount || credited.amount || 1)));
  const revoke = refunded >= (charge.amount || credited.amount || 1);
  // Decide and apply the deduction inside one atomic update of the user, based
  // on what this session has already had removed, so concurrent syncs can't
  // deduct twice.
  let delta = 0;
  let revoked = false;
  let shotRevoked = false;
  await users.update(credited.userId, (u) => {
    delta = 0;
    revoked = false;
    shotRevoked = false;
    const prior = (u.refunds || []).filter((r) => r.sessionId === session.id).reduce((n, r) => n + (r.shootsRemoved || 0), 0);
    const purchase = (u.purchases || []).find((p) => p.sessionId === session.id);
    delta = Math.max(0, target - prior);
    revoked = revoke && !!purchase && !purchase.refunded;
    if (!delta && !revoked) return UNCHANGED;
    if (delta) u.credits = Math.max(0, (u.credits || 0) - delta);
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
    u.refunds = [...(u.refunds || []), { sessionId: session.id, shootsRemoved: delta, ...(revoked ? { revoked: true } : {}), amountRefunded: refunded, ...(disputed ? { disputed: true } : {}), at: new Date().toISOString() }];
  });
  if (!delta && !revoked) return { removed: 0, revoked: false };
  if (shotRevoked) await showcase.removeForShot(credited.userId, credited.shootId, credited.shotId).catch((err) => console.error("[billing] showcase cleanup", session.id, err.message));
  else if (revoked) await showcase.removeLocked(credited.userId).catch((err) => console.error("[billing] showcase cleanup", session.id, err.message));
  await putJSON(`refunds/${session.id}.json`, { sessionId: session.id, userId: credited.userId, removed: target, ...(revoked ? { revoked: true } : {}), amountRefunded: refunded, ...(disputed ? { disputed: true } : {}), at: new Date().toISOString() });
  return { removed: delta, revoked };
}

// Returns { added, removed } shoot credits, and revoked: purchases refunded
// since the last check.
export async function sync(user) {
  if (!user.stripeCustomerId) return { added: 0, removed: 0, revoked: 0 };
  // Every session, not just the latest page (older purchases can be refunded too).
  const sessions = [];
  for await (const s of client().checkout.sessions.list({ customer: user.stripeCustomerId, limit: 100, expand: ["data.payment_intent.latest_charge"] })) {
    sessions.push(s);
    if (sessions.length >= 500) break;
  }
  let added = 0;
  let removed = 0;
  let revoked = 0;
  for (const s of sessions) {
    added += (await fulfil(s)).shoots;
    const r = await reconcileRefund(s).catch((err) => (console.error("[billing] refund check", s.id, err.message), { removed: 0, revoked: false }));
    removed += r.removed;
    if (r.revoked) revoked++;
  }
  return { added, removed, revoked };
}

export async function handleWebhook(rawBody, signature) {
  const event = client().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await fulfil(event.data.object);
  }
  // Refunds and chargebacks take the matching shoots back straight away,
  // rather than waiting for the buyer's next visit (sync).
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const obj = event.data.object;
    const paymentIntent = obj.payment_intent;
    if (!paymentIntent) return;
    const { data } = await client().checkout.sessions.list({ payment_intent: String(paymentIntent), limit: 1, expand: ["data.payment_intent.latest_charge"] });
    if (data[0]) await reconcileRefund(data[0], { disputed: event.type === "charge.dispute.created" ? obj.amount || 0 : 0 });
  }
}
