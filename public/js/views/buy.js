import { $, html, icon, api, spinner, state } from "../core.js";
import { pixel } from "../pixel.js";
import { PACKAGES } from "../shared/catalog.js";

// /app/buy/:package — checkout. With a Stripe publishable key configured,
// Stripe's payment form is embedded right here (Embedded Checkout); otherwise
// it hands off to Stripe's hosted checkout page. Either way Stripe sends the
// customer back to /app?checkout=success, which confirms and grants the shoots.

// Stripe.js must be loaded from js.stripe.com (PCI), never bundled. "dahlia"
// matches the Stripe API version the server library uses.
const STRIPE_JS = "https://js.stripe.com/dahlia/stripe.js";
let loading = null;
function loadStripe() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  return (loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = STRIPE_JS;
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe didn't load.")));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("The payment form couldn't load."));
    };
    document.head.append(s);
  }));
}

export function renderBuy({ root }, packageId) {
  const pkg = PACKAGES.find((p) => p.id === packageId);
  let disposed = false;
  let checkout = null;
  const shell = (body) =>
    (root.innerHTML = html`<main id="main" class="container app-main"><div class="empty view-enter" style="max-width:640px;margin:0 auto">${body}</div></main>`.v);
  const failed = (message) =>
    shell(html`<p class="eyebrow">Checkout</p><h1 class="display h-2">We couldn't start checkout.</h1><p class="lede">${message}</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn btn-ink" href="/app" data-link>Back to your shoots</a><a class="btn btn-ghost" href="/#pricing">Pricing</a></div>`);
  if (!pkg) {
    shell(html`<p class="eyebrow">Checkout</p><h1 class="display h-2">That package doesn't exist.</h1><p class="lede">Pick one from the pricing section.</p><a class="btn btn-ink" href="/#pricing">See pricing</a>`);
    return;
  }

  // Hosted checkout: redirect to Stripe.
  const redirect = async () => {
    shell(html`<p class="eyebrow">${icon("lock")} Secure checkout</p><h1 class="display h-2">${pkg.name}: ${pkg.shoots} shoots for $${pkg.price}</h1><p class="lede">Taking you to Stripe to pay…</p><div style="display:flex;justify-content:center">${spinner()}</div>`);
    try {
      const { url, eventId, value } = await api("/api/billing/checkout", { method: "POST", body: { packageId: pkg.id } });
      if (disposed) return;
      pixel("InitiateCheckout", { value, currency: "USD", content_name: pkg.name }, eventId);
      // Give the Pixel a moment to send before leaving for Stripe (the server sends it too).
      if (window.fbq) await new Promise((r) => setTimeout(r, 300));
      if (!disposed) location.assign(url);
    } catch (err) {
      if (!disposed) failed(err.message);
    }
  };

  const key = state.stripe?.publishableKey;
  if (!key) {
    redirect();
    return () => (disposed = true);
  }

  // Embedded checkout: order summary beside Stripe's payment form.
  const others = PACKAGES.filter((p) => p.id !== pkg.id);
  root.innerHTML = html`
  <main id="main" class="container app-main view-enter">
    <div class="checkout">
      <section class="checkout-summary" aria-labelledby="order-title">
        <p class="eyebrow">${icon("lock")} Secure checkout</p>
        <h1 class="display h-2" id="order-title">${pkg.name} package</h1>
        <p class="checkout-price"><strong class="tabular">$${pkg.price}</strong><span>one-time · no subscription</span></p>
        <ul class="checkout-features">${pkg.features.map((f) => html`<li>${icon("check")}<span>${f}</span></li>`)}</ul>
        <p class="checkout-note">${icon("shield-check")}<span>Covered by our <a class="link" href="/refunds" data-link>money-back guarantee</a>. Unused shoots don't expire while your account is open.</span></p>
        <p class="small muted">Want a different package? ${others.map((p, i) => html`${i ? " or " : ""}<a class="link" href="/app/buy/${p.id}" data-link>${p.name} ($${p.price})</a>`)}.</p>
      </section>
      <section class="checkout-pay" aria-label="Payment">
        <div class="checkout-frame light-island" id="checkout"><div class="checkout-loading">${spinner()}<span>Loading the secure payment form…</span></div></div>
        <p class="small muted checkout-fine">Payments are processed securely by Stripe. We never see or store your card number.</p>
      </section>
    </div>
  </main>`.v;

  (async () => {
    try {
      const Stripe = await loadStripe();
      if (disposed) return;
      checkout = await Stripe(key).initEmbeddedCheckout({
        fetchClientSecret: async () => {
          const { clientSecret, eventId, value } = await api("/api/billing/checkout", { method: "POST", body: { packageId: pkg.id, embedded: true } });
          if (!clientSecret) throw new Error("Checkout isn't available right now.");
          pixel("InitiateCheckout", { value, currency: "USD", content_name: pkg.name }, eventId);
          return clientSecret;
        },
      });
      if (disposed) return void checkout.destroy();
      $("#checkout").innerHTML = "";
      checkout.mount("#checkout");
    } catch (err) {
      if (disposed) return;
      // If the embedded form can't load (blocked script, old browser), fall
      // back to Stripe's hosted page rather than leaving the buyer stuck.
      console.warn("[checkout] embedded form failed; using hosted checkout:", err.message);
      checkout?.destroy();
      redirect();
    }
  })();

  return () => {
    disposed = true;
    checkout?.destroy();
  };
}
