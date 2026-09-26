// Stripe Checkout for one-time shoot packages.
//
// A purchase adds credits (one per shoot) to the buyer's account. Credits are
// granted from three places, all idempotent via a write-once record per
// Checkout Session:
//   1. confirm() — when the buyer lands back on the dashboard after paying
//   2. sync()    — on later dashboard visits, in case they closed the tab
//   3. the webhook, if STRIPE_WEBHOOK_SECRET is configured

import Stripe from "stripe";
import { users } from "./store.js";
import { createJSON } from "./storage.js";
import { PACKAGES } from "../public/js/shared/catalog.js";

let stripe;
const client = () => {
  if (stripe) return stripe;
  // STRIPE_API_BASE is only for local QA against scripts/dev/mock-ai.js.
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") } : {});
  return stripe;
};
export const billingEnabled = () => !!process.env.STRIPE_SECRET_KEY;

async function ensureCustomer(user) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await client().customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
  await users.update(user.id, (u) => (u.stripeCustomerId = customer.id));
  return customer.id;
}

export async function createCheckout(user, packageId, origin) {
  const pkg = PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw Object.assign(new Error("That package doesn't exist."), { status: 400 });
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
          unit_amount: pkg.price * 100,
          product_data: { name: `AI Headshot Guru — ${pkg.name}`, description: `${pkg.shoots} headshot shoots (up to ${pkg.shoots * 8} headshots)` },
        },
      },
    ],
    metadata: { userId: user.id, packageId: pkg.id, shoots: String(pkg.shoots) },
    success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app?checkout=cancelled`,
  });
  return session.url;
}

// Grant credits for a paid session exactly once. Returns shoots added (0 if
// unpaid or already granted).
async function fulfil(session) {
  if (session.payment_status !== "paid") return 0;
  const userId = session.metadata?.userId || session.client_reference_id;
  const shoots = Number(session.metadata?.shoots || 0);
  if (!userId || !shoots) return 0;
  const first = await createJSON(`payments/${session.id}.json`, {
    sessionId: session.id,
    userId,
    packageId: session.metadata?.packageId,
    shoots,
    amount: session.amount_total,
    currency: session.currency,
    at: new Date().toISOString(),
  });
  if (!first) return 0;
  await users.update(userId, (u) => {
    u.credits = (u.credits || 0) + shoots;
    u.purchases = [...(u.purchases || []), { sessionId: session.id, packageId: session.metadata?.packageId, shoots, amount: session.amount_total, at: new Date().toISOString() }];
  });
  return shoots;
}

export async function confirm(user, sessionId) {
  const session = await client().checkout.sessions.retrieve(String(sessionId));
  const owner = session.metadata?.userId || session.client_reference_id;
  if (owner !== user.id) throw Object.assign(new Error("That purchase belongs to a different account."), { status: 403 });
  return { added: await fulfil(session), paid: session.payment_status === "paid" };
}

export async function sync(user) {
  if (!user.stripeCustomerId) return 0;
  const sessions = await client().checkout.sessions.list({ customer: user.stripeCustomerId, limit: 20 });
  let added = 0;
  for (const s of sessions.data) added += await fulfil(s);
  return added;
}

export async function handleWebhook(rawBody, signature) {
  const event = client().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await fulfil(event.data.object);
  }
}
