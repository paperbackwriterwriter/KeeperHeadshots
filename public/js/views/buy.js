import { $, html, icon, api, spinner, state } from "../core.js";
import { pixel, pageUrl } from "../pixel.js";
import { PACKAGES, PREVIEW_OFFERS, offerFor, isPreviewOffer } from "../shared/catalog.js";

// /app/buy/:package — checkout. With a Stripe publishable key configured,
// Stripe's payment form is embedded right here (Embedded Checkout); otherwise
// it hands off to Stripe's hosted checkout page. Either way Stripe sends the
// customer back to /app?checkout=success, which confirms and grants the shoots.
// A preview offer (/app/buy/keep?shoot=<id>) is bought for one free preview
// shoot, and Stripe sends the customer back to that shoot instead.

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

// On previews and local copies Stripe runs in test mode: say so, with the
// test card, so nobody mistakes it for a real payment.
const testNote = () =>
  state.stripe?.mode === "test" ? html`<p class="banner banner-warn small" style="margin:0 0 16px">${icon("info")}<span><b>Test mode.</b> No real charge. Pay with card 4242 4242 4242 4242, any future date, any CVC.</span></p>` : "";

export function renderBuy({ root }, packageId) {
  const pkg = offerFor(packageId);
  const offer = !!pkg && isPreviewOffer(pkg.id);
  const q = new URLSearchParams(location.search);
  const shootId = offer ? q.get("shoot") || "" : null;
  // "Keep your pick" is for one headshot of that shoot.
  const shotId = offer ? q.get("shot") || "" : null;
  const back = offer ? `/app/shoot/${shootId}` : "/app";
  const headline = offer ? `${pkg.name}: $${pkg.price}` : `${pkg?.name}: ${pkg?.shoots} shoots for $${pkg?.price}`;
  const body = (extra) => ({ packageId: pkg.id, ...(offer ? { shootId, ...(pkg.id === "keep" ? { shotId } : {}) } : {}), pageUrl: pageUrl(), ...extra });
  let disposed = false;
  let checkout = null;
  const shell = (body) =>
    (root.innerHTML = html`<main id="main" class="container app-main"><div class="empty view-enter" style="max-width:640px;margin:0 auto">${body}</div></main>`.v);
  const failed = (message) =>
    shell(html`<p class="eyebrow">Checkout</p><h1 class="display h-2">We couldn't start checkout.</h1><p class="lede">${message}</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn btn-ink" href="${back}" data-link>${offer ? "Back to your shoot" : "Back to your shoots"}</a><a class="btn btn-ghost" href="/#pricing">Pricing</a></div>`);
  if (!pkg) {
    shell(html`<p class="eyebrow">Checkout</p><h1 class="display h-2">That package doesn't exist.</h1><p class="lede">Pick one from the pricing section.</p><a class="btn btn-ink" href="/#pricing">See pricing</a>`);
    return;
  }
  if (state.user?.demo) {
    // Don't ask Stripe to create a payment form for a read-only account.
    // A sample's shoot IDs cannot carry over to the visitor's new account.
    const next = offer ? "/app/new" : location.pathname + location.search;
    shell(html`<p class="eyebrow">Checkout</p><h1 class="display h-2">Create your account to continue.</h1><p class="lede">The demo account is read-only. Create a free account to choose ${offer ? pkg.name : `the ${pkg.name} package`} or try your own headshots first.</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn btn-flash" href="${`/signup?next=${encodeURIComponent(next)}`}" data-link>Create free account ${icon("arrow-right")}</a><a class="btn btn-ghost" href="/app" data-link>Back to the demo</a></div>`);
    return;
  }
  if (offer && (!shootId || (pkg.id === "keep" && !shotId))) {
    shell(html`<p class="eyebrow">Checkout</p><h1 class="display h-2">Pick from your shoot first.</h1><p class="lede">${pkg.name} is chosen on your free preview's results page${pkg.id === "keep" ? ", for the headshot you pick there" : ""}.</p><a class="btn btn-ink" href="${shootId ? back : "/app"}" data-link>${shootId ? "Back to your shoot" : "Your shoots"}</a>`);
    return;
  }

  // Hosted checkout: redirect to Stripe.
  const redirect = async () => {
    shell(html`${testNote()}<p class="eyebrow">${icon("lock")} Secure checkout</p><h1 class="display h-2">${headline}</h1><p class="lede">Taking you to Stripe to pay…</p><div style="display:flex;justify-content:center">${spinner()}</div>`);
    try {
      const { url, eventId, value } = await api("/api/billing/checkout", { method: "POST", body: body() });
      if (disposed) return;
      pixel("InitiateCheckout", { value, currency: "USD", content_name: pkg.name }, eventId);
      // Give the Pixel a moment to send before leaving for Stripe (the server sends it too).
      if (window.fbq) await new Promise((r) => setTimeout(r, 300));
      // Replace, not push: Back from Stripe then returns to the page before
      // this one, rather than here (which would send them straight back).
      if (!disposed) location.replace(url);
    } catch (err) {
      if (disposed) return;
      // Already kept or unlocked (e.g. Back from Stripe after paying): the
      // shoot itself is where to go.
      if (offer && ["kept", "not_preview"].includes(err.data?.code)) return location.replace(back);
      failed(err.message);
    }
  };

  // The key normally arrives with the session (core.js). A tab opened before
  // a deploy can be running older core code without it, so ask the server.
  const withKey = async () => state.stripe?.publishableKey || (await api("/api/me").catch(() => null))?.stripe?.publishableKey || null;
  withKey().then((key) => {
    if (disposed) return;
    if (key) embed(key);
    else redirect();
  });
  return () => {
    disposed = true;
    checkout?.destroy();
  };

  // Embedded checkout: order summary beside Stripe's payment form.
  function embed(key) {
    const others = offer ? PREVIEW_OFFERS.filter((p) => p.id !== pkg.id && (p.id !== "keep" || shotId)) : PACKAGES.filter((p) => p.id !== pkg.id);
    const link = (p) => (offer ? `/app/buy/${p.id}?shoot=${encodeURIComponent(shootId)}${p.id === "keep" ? `&shot=${encodeURIComponent(shotId)}` : ""}` : `/app/buy/${p.id}`);
    root.innerHTML = html`
    <main id="main" class="container app-main view-enter">
      <div class="checkout">
        <section class="checkout-summary" aria-labelledby="order-title">
          ${testNote()}
          <p class="eyebrow">${icon("lock")} Secure checkout</p>
          <h1 class="display h-2" id="order-title">${offer ? pkg.name : `${pkg.name} package`}</h1>
          <p class="checkout-price"><strong class="tabular">$${pkg.price}</strong><span>one-time · no subscription</span></p>
          <ul class="checkout-features">${pkg.features.map((f) => html`<li>${icon("check")}<span>${f}</span></li>`)}</ul>
          <p class="checkout-note">${icon("shield-check")}<span>${offer ? "One-time payment. Your headshots stay in your account to download any time." : html`Your first package is covered by our <a class="link" href="/refunds" data-link>money-back guarantee</a>. Unused shoots don't expire while your account is open.`}</span></p>
          <p class="small muted">${offer ? (others.length ? "Rather have" : "") : "Want a different package?"} ${others.map((p, i) => html`${i ? " or " : ""}<a class="link" href="${link(p)}" data-link>${p.name} ($${p.price})</a>`)}${offer ? html`${others.length ? "? Or a" : "Or a"} package for more shoots: ${PACKAGES.map((p, i) => html`${i ? ", " : ""}<a class="link" href="/app/buy/${p.id}" data-link>${p.name} ($${p.price})</a>`)}` : ""}.</p>
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
        // Fetch before handing over to Stripe: its asynchronous callback
        // failures don't reliably reject createEmbeddedCheckoutPage().
        // Account/API errors belong in our UI, not a generic Stripe panel.
        let session;
        try {
          session = await api("/api/billing/checkout", { method: "POST", body: body({ embedded: true }) });
          if (!session.clientSecret) throw new Error("Checkout isn't available right now.");
        } catch (err) {
          if (disposed) return;
          if (offer && ["kept", "not_preview"].includes(err.data?.code)) return location.replace(back);
          failed(err.message);
          return;
        }
        if (disposed) return;
        const stripe = Stripe(key);
        // Stripe.js "dahlia" renamed initEmbeddedCheckout() to
        // createEmbeddedCheckoutPage() (the old name now throws).
        const create = (stripe.createEmbeddedCheckoutPage || stripe.initEmbeddedCheckout).bind(stripe);
        checkout = await create({
          fetchClientSecret: async () => {
            const { clientSecret, eventId, value } = session;
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
        // Tell the server why, so a broken embedded form shows up in the logs.
        api("/api/billing/embed-error", { method: "POST", body: { message: String(err?.message || err).slice(0, 300) } }).catch(() => {});
        checkout?.destroy();
        redirect();
      }
    })();
  }
}
