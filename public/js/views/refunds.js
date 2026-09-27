import { html, icon } from "../core.js";
import { footer } from "./landing.js";
import { CONTACT_EMAIL } from "./contact.js";

// The written terms behind the "money-back guarantee" shown on the site.
export const POLICY_UPDATED = "September 27, 2026";

export function renderRefunds({ root }) {
  root.innerHTML = html`
  <main id="main" class="container app-main view-enter policy-page">
    <article class="policy">
      <p class="eyebrow"><span class="dot"></span>Refund policy</p>
      <h1 class="display h-1" style="margin-top:12px">Our money-back guarantee</h1>
      <p class="lede">If none of the headshots from your paid shoot are usable, we'll refund your purchase in full.</p>
      <p class="small muted">Last updated ${POLICY_UPDATED}</p>

      <div class="policy-callout">
        ${icon("shield-check")}
        <div><b>The short version</b><span>If none of the headshots from your first paid shoot are usable, tell us within 30 days and we'll refund the whole package to your card. No forms, no hoops.</span></div>
      </div>

      <h2 class="h-3">What's covered</h2>
      <ul>
        <li>Every paid package: Starter, Professional and Executive.</li>
        <li>If none of the headshots from the <b>first paid shoot</b> in your package are ones you'd use professionally, we refund the <b>full package price</b>.</li>
        <li>If you've already developed more than one shoot from the package, we refund the shoots you haven't used, pro rata. For example, if you bought Professional (6 shoots for $39) and used two, we refund $26.</li>
        <li>Your free first shoot costs nothing, so there's nothing to refund.</li>
      </ul>

      <h2 class="h-3">How to ask for a refund</h2>
      <ol>
        <li>Within <b>30 days</b> of your purchase, <a class="link" href="/contact?topic=billing" data-link>contact us</a> (choose "Billing or refunds") or email <a class="link" href="mailto:${CONTACT_EMAIL}?subject=Refund%20request">${CONTACT_EMAIL}</a>.</li>
        <li>Include the email address you paid with and, if you can, the name of the shoot.</li>
        <li>We reply within one business day. We may ask what went wrong so we can improve, but we won't make the refund depend on your answer.</li>
      </ol>

      <h2 class="h-3">What happens next</h2>
      <ul>
        <li>We refund the original payment method through Stripe, our payment provider. Most banks show it within 5–10 business days.</li>
        <li>Any shoots left from the refunded package are removed from your account.</li>
        <li>Please don't use headshots from a refunded shoot.</li>
      </ul>

      <h2 class="h-3">Before you ask</h2>
      <p>Often a better set is one step away. Frames held back by our quality check can be retried for free, you can re-grade a shoot, and adding a couple of clearer selfies usually makes a big difference. If you'd like help, <a class="link" href="/contact?topic=shoot" data-link>ask us</a> and we'll look at your photos with you.</p>

      <h2 class="h-3">Other refunds</h2>
      <ul>
        <li>Charged twice, or charged for a shoot that failed because of a problem on our side? We refund that in full at any time.</li>
        <li>The guarantee applies once per person.</li>
        <li>If something's wrong with a charge, please contact us before disputing it with your bank. It's usually faster for you, and we'll sort it out.</li>
      </ul>
    </article>
  </main>
  ${footer()}`.v;
}
