import { html, icon, api, spinner } from "../core.js";
import { PACKAGES } from "../shared/catalog.js";

// /app/buy/:package — hands off to Stripe's hosted checkout page.
export async function renderBuy({ root }, packageId) {
  const pkg = PACKAGES.find((p) => p.id === packageId);
  const shell = (body) =>
    (root.innerHTML = html`<main id="main" class="container app-main"><div class="empty view-enter" style="max-width:640px;margin:0 auto">${body}</div></main>`.v);
  if (!pkg) {
    shell(html`<p class="eyebrow">Checkout</p><h1 class="display h-2">That package doesn't exist.</h1><p class="lede">Pick one from the pricing section.</p><a class="btn btn-ink" href="/#pricing">See pricing</a>`);
    return;
  }
  shell(html`<p class="eyebrow">${icon("lock")} Secure checkout</p><h1 class="display h-2">${pkg.name}: ${pkg.shoots} shoots for $${pkg.price}</h1><p class="lede">Taking you to Stripe to pay…</p><div style="display:flex;justify-content:center">${spinner()}</div>`);
  try {
    const { url } = await api("/api/billing/checkout", { method: "POST", body: { packageId: pkg.id } });
    location.assign(url);
  } catch (err) {
    shell(html`<p class="eyebrow">Checkout</p><h1 class="display h-2">We couldn't start checkout.</h1><p class="lede">${err.message}</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn btn-ink" href="/app" data-link>Back to your shoots</a><a class="btn btn-ghost" href="/#pricing">Pricing</a></div>`);
  }
}
