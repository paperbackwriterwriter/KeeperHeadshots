import { html, icon } from "../core.js";
import { footer } from "./landing.js";
import { CONTACT_EMAIL } from "./contact.js";

// Privacy Policy and Terms of Service. Keep these in step with what the code
// actually does (lib/meta.js, lib/billing.js, lib/store.js, lib/ai.js).
export const LEGAL_UPDATED = "September 29, 2026";

const mail = html`<a class="link" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;

function page({ eyebrow, title, lede, callout, body, updated = LEGAL_UPDATED }) {
  return html`
  <main id="main" class="container app-main view-enter policy-page">
    <article class="policy">
      <p class="eyebrow"><span class="dot"></span>${eyebrow}</p>
      <h1 class="display h-1" style="margin-top:12px">${title}</h1>
      <p class="lede">${lede}</p>
      <p class="small muted">Last updated ${updated}</p>
      <div class="policy-callout">${icon("shield-check")}<div><b>The short version</b><span>${callout}</span></div></div>
      ${body}
    </article>
  </main>
  ${footer()}`;
}

export function renderPrivacy({ root }) {
  root.innerHTML = page({
    eyebrow: "Privacy policy",
    updated: "October 9, 2026",
    title: "Your privacy",
    lede: "What we collect, why we collect it, who helps us run the service, and the choices you have.",
    callout:
      "We use your photos only to make your headshots. We don't sell them, we don't use them to train AI, and we don't use them in our marketing unless you choose to share one. You can delete a shoot, or your whole account, at any time.",
    body: html`
      <p>This policy covers keeperheadshots.com and the Keeper Headshots studio ("Keeper Headshots", "we", "us"). Keeper Headshots is based in Iowa, USA. If you have a question about your data, email ${mail}.</p>

      <h2 class="h-3">What we collect</h2>
      <ul>
        <li><b>Account details:</b> your name, email address and password. We store passwords only as a one-way scrambled hash, never as the password itself. If you continue with Google, Google tells us your name, your email address (and that Google has confirmed it) and an account number that links your Google sign-in to your Keeper account. We don't get your Google password, contacts or anything else.</li>
        <li><b>Your photos:</b> the selfies you upload, the headshots we create from them, the looks you choose, and the results of our AI photo checks and grading.</li>
        <li><b>Purchases:</b> which package you bought, the amount, the date and your Stripe customer reference. Payments are handled by Stripe. We never see or store your full card number.</li>
        <li><b>Messages:</b> when you use the contact form, we keep your name, email, message and IP address (the IP address helps us stop spam).</li>
        <li><b>Device and usage information:</b> your IP address, browser type, the pages you visit and similar technical details, collected through cookies and our server logs.</li>
      </ul>

      <h2 class="h-3">How we use it</h2>
      <ul>
        <li>To run the studio: check your photos, create your headshots, run our quality check on every headshot, and show you the results.</li>
        <li>To manage your account and purchases, including refunds, and to send account emails such as the link that confirms your email address and a note when your headshots are ready.</li>
        <li>To send at most two reminder emails: one if your photos pass the check but you haven't developed them, and one after your free shoot or if you start a checkout and don't finish it. Every reminder has a link to stop them, and you can turn them off on your <a class="link" href="/app/account" data-link>Account page</a>. Now and then we may also email an offer, such as a discount code, to people who signed up but haven't bought; the same link and setting stop those too.</li>
        <li>To answer your messages and help with your shoots.</li>
        <li>To keep the service secure and prevent fraud and abuse, including misuse of the free shoot.</li>
        <li>To measure how well our ads work (see "Advertising and cookies" below).</li>
        <li>To meet our legal, tax and accounting obligations.</li>
      </ul>

      <h2 class="h-3">How AI works with your photos</h2>
      <p>To create and check your headshots, we send your photos to two AI providers: <b>Anthropic</b> (the Claude models check your selfies and review each headshot for likeness and quality) and <b>Google</b> (the Gemini models create the headshots). They process your photos for us under business terms that don't allow them to train their models on our data. They may keep data for a limited time for safety and abuse monitoring.</p>
      <p><b>We never use your photos or headshots to train AI models</b>, and we never use them in ads, examples or marketing without your written permission. The example people shown on our website are AI-generated models, not customers, except in the "From our customers" section described below.</p>
      <p><b>Sharing your results:</b> on your finished shoot you can choose to share one headshot for our home page, with the name, job and words you give us. That's the only way a customer's headshot appears on our website: nothing is shown unless you tick the box giving permission, and we review each one before showing it. We keep a copy of that headshot and the details you gave until you take it down (from the shoot or your Account page), delete that shoot, delete your account, or a package you bought is refunded; it then disappears from the site within about 10 minutes. We don't use it anywhere else, such as in ads.</p>

      <h2 class="h-3">Face data</h2>
      <p>We don't create or store face templates, face measurements or other biometric identifiers. Our AI looks at your photos to check that each headshot looks like you, the way a person would compare two pictures. We keep the photos themselves, as described below, and nothing derived from your face.</p>
      <p>Please upload photos of yourself only, or of someone who has given you permission.</p>

      <h2 class="h-3">Who we share it with</h2>
      <p>We share personal information only with companies that help us run Keeper Headshots, and only what they need:</p>
      <ul>
        <li><b>Vercel</b>: hosts the website and stores your account, photos and headshots (in the United States).</li>
        <li><b>Anthropic</b> and <b>Google</b>: AI processing, as described above.</li>
        <li><b>Stripe</b>: payments and refunds.</li>
        <li><b>Google</b>: signing you in, if you choose "Continue with Google".</li>
        <li><b>Cloudflare</b>: the Turnstile security check on the sign-up, contact and password-reset forms, which checks that you're a person and not a bot. It looks at technical signals from your browser and isn't used for advertising.</li>
        <li><b>Resend</b>: sending our emails (confirmation codes, receipts, reminders and copies of contact-form messages).</li>
        <li><b>ImprovMX</b> and <b>Google (Gmail)</b>: receiving and answering the messages you send us.</li>
        <li><b>Meta</b> (Facebook and Instagram): advertising measurement, as described below.</li>
      </ul>
      <p><b>Team headshots:</b> if a colleague invites you to their team, they see your name, email address and the progress of your shoot, and can view and download your finished headshots. They never see your selfies. If you invite people, we email each of them your invitation with your name and email address as the reply-to.</p>
      <p>We may also share information if the law requires it, to protect our rights or someone's safety, or with a buyer if Keeper Headshots is ever sold (this policy would still apply to your data). <b>We don't sell your personal information for money.</b></p>

      <h2 class="h-3">Advertising and cookies</h2>
      <ul>
        <li><b>Sign-in cookie:</b> keeps you signed in for up to 30 days. The site can't work without it.</li>
        <li><b>Known-browser cookie:</b> set when you sign in and kept for up to a year, it tells us this browser has signed in to your account before, so strangers guessing passwords from elsewhere can't lock you out. It holds only your account's ID, signed by us.</li>
        <li><b>Site analytics:</b> we use Vercel Web Analytics to count visits and see which pages are viewed. It doesn't use cookies and doesn't identify you.</li>
        <li><b>Session storage:</b> the studio saves a couple of small settings in your browser while a shoot is being set up (whether to check photos automatically, and a team invitation you're accepting).</li>
        <li><b>Meta Pixel:</b> we use Meta's advertising tools to find out whether our Facebook and Instagram ads lead to sign-ups and purchases. The Meta Pixel sets cookies in your browser, and our server also tells Meta when you create an account, start a checkout or buy a package. It sends a scrambled (hashed) version of your email address and account ID, your IP address and browser details. Meta uses this to measure and improve our ads, and may use it to show you ads.</li>
      </ul>
      <p>Under some US state privacy laws, this use of Meta's tools may count as "sharing" personal information or "targeted advertising." You can opt out in any of these ways:</p>
      <ul>
        <li>Turn on <b>Global Privacy Control</b> in your browser or with a browser extension. When your browser sends that signal, we don't load the Meta Pixel and don't send your events to Meta from our server.</li>
        <li>Email ${mail} and ask us to opt you out.</li>
        <li>Change your ad settings in your Facebook or Instagram account, or block cookies in your browser.</li>
      </ul>

      <h2 class="h-3">How long we keep it</h2>
      <ul>
        <li><b>Photos and headshots:</b> until you delete the shoot, or until your account is deleted. Deleting a shoot removes its selfies and headshots from our storage straight away.</li>
        <li><b>Unfinished shoots:</b> a shoot that was never developed, and hasn't been changed for 90 days, is deleted automatically with its selfies.</li>
        <li><b>Account details:</b> while your account is open. You can delete your account at any time on your <a class="link" href="/app/account" data-link>Account page</a>. That removes your account and all your shoots, selfies and headshots straight away. If you email us instead, we'll do it within 30 days. Our nightly backups hold account and shoot records (never photos or headshots) for 30 days, so a deleted record can remain in a backup for up to 30 days.</li>
        <li><b>Free-shoot record:</b> if you used your free shoot, we keep a scrambled (hashed) copy of your email address after your account is deleted, with a note that the free shoot was used. That stops the free shoot being claimed twice. It doesn't include your name, photos or anything else. The count of free photo checks used by an email inbox is kept the same way, so that variations of one address (like name+1@…) share the free checks.</li>
        <li><b>Shared headshots:</b> if you shared a headshot for our home page, until you take it down, delete that shoot, delete your account, or a package you bought is refunded.</li>
        <li><b>Purchase records:</b> as long as tax and accounting rules require, usually up to 7 years.</li>
        <li><b>Messages:</b> the copy stored from the contact form is deleted automatically after 12 months. Replies we exchange by email stay in our inbox as a record of the conversation. To limit how many messages can be sent from one connection, we count messages per hour against a scrambled (hashed) form of your IP address; those counts are deleted after 2 days.</li>
      </ul>

      <h2 class="h-3">Your choices and rights</h2>
      <p>Wherever you live, you can ask us to:</p>
      <ul>
        <li>tell you what personal information we hold about you and give you a copy;</li>
        <li>correct it;</li>
        <li>delete it, including your whole account;</li>
        <li>stop using it for advertising.</li>
      </ul>
      <p>You can download your headshots, delete shoots and delete your account yourself in the studio. For anything else, email ${mail} from the address on your account, so we know the request is really from you. We'll reply within 30 days. If we can't do what you asked, we'll explain why, and you can reply to ask us to reconsider. We'll never treat you differently for using these rights.</p>

      <h2 class="h-3">Security</h2>
      <p>The site uses encrypted connections (HTTPS) everywhere. Photos are kept in private storage that only your account can reach, passwords are hashed, and sign-in cookies are signed so they can't be forged. No system is perfectly secure, but we work to protect your information and will tell you if a breach affects you.</p>

      <h2 class="h-3">Children</h2>
      <p>Keeper Headshots is for adults (18 and over). We don't knowingly collect information from anyone under 18. If you think a child has used the service, email us and we'll delete their information.</p>

      <h2 class="h-3">Where your data is kept</h2>
      <p>We and our providers store and process data in the United States. If you use Keeper Headshots from another country, your information will be transferred to the US.</p>

      <h2 class="h-3">Changes to this policy</h2>
      <p>If we change this policy, we'll update the date at the top. If a change materially affects how we use your information, we'll email you before it takes effect.</p>

      <h2 class="h-3">Contact</h2>
      <p>Questions or requests: ${mail}, or use our <a class="link" href="/contact" data-link>contact form</a>.</p>`,
  }).v;
}

export function renderTerms({ root }) {
  root.innerHTML = page({
    eyebrow: "Terms of service",
    updated: "October 9, 2026",
    title: "Terms of service",
    lede: "The agreement between you and Keeper Headshots when you use the studio.",
    callout:
      "Upload photos of yourself, and use the service honestly. You own your headshots. Packages are one-time payments, not subscriptions, and the money-back guarantee applies. AI results can vary, so check each headshot before you use it.",
    body: html`
      <h2 class="h-3">1. Agreeing to these terms</h2>
      <p>These terms are an agreement between you and Keeper Headshots ("we", "us"), based in Iowa, USA. By creating an account or using keeperheadshots.com, you agree to these terms and to our <a class="link" href="/privacy" data-link>Privacy Policy</a>. You must be at least 18 years old to use Keeper Headshots.</p>

      <h2 class="h-3">2. The service</h2>
      <p>Keeper Headshots uses AI to create professional headshots from photos you upload. Each shoot checks your photos, creates headshots in the looks you choose, runs a quality check on every headshot and grades the results. New accounts get one free shoot. Paid packages add more shoots.</p>

      <h2 class="h-3">3. Your account</h2>
      <ul>
        <li>Give accurate information and keep your password private. You're responsible for what happens in your account.</li>
        <li>The free shoot is a preview: its headshots carry a watermark and are provided at a reduced size. Keeping your pick ($8.99) unlocks that one headshot at full resolution; keeping them all ($14.99) or buying any package unlocks every headshot from the preview. The free shoot is limited to one per person. Please don't create extra accounts to get more free shoots.</li>
        <li>Tell us straight away at ${mail} if you think someone else has used your account.</li>
      </ul>

      <h2 class="h-3">4. Your photos</h2>
      <ul>
        <li>Only upload photos of yourself, or of someone who has given you permission to create headshots of them. You must have the right to use every photo you upload.</li>
        <li>You keep ownership of your photos. You give us permission to store them, process them and send them to our AI providers only to provide the service to you. That permission ends when you delete the photos or your account, except for copies we're legally required to keep.</li>
      </ul>

      <h2 class="h-3">5. Your headshots</h2>
      <p>As far as the law allows, the headshots created for you are yours. You can use them for any lawful purpose, including your résumé, LinkedIn profile, company website, press and print, and commercial use. We don't claim any rights in them, and we won't use them in our marketing without your written permission. Copyright rules for AI-generated images differ from country to country, so we can't promise that a copyright office would register them.</p>

      <h2 class="h-3">6. Acceptable use</h2>
      <p>Don't use Keeper Headshots to:</p>
      <ul>
        <li>create images of anyone without their permission, or of anyone under 18;</li>
        <li>create nude, sexual, violent or hateful images;</li>
        <li>impersonate someone, or deceive or defraud anyone (for example, on identity documents or to fake who you are);</li>
        <li>break any law or anyone else's rights;</li>
        <li>hack, overload, scrape or reverse-engineer the service, or get around its limits;</li>
        <li>resell the service or make it available to others without our permission.</li>
      </ul>
      <p>We may block uploads, remove content, or suspend or close accounts that break these rules.</p>

      <h2 class="h-3">7. Payments</h2>
      <ul>
        <li>Prices are in US dollars and shown before you pay. Packages are one-time purchases, not subscriptions.</li>
        <li>Payments are processed by Stripe. Each shoot you use takes one shoot from your package. Unused shoots don't expire while your account is open.</li>
        <li>Refunds follow our <a class="link" href="/refunds" data-link>money-back guarantee</a>. If a shoot fails because of a problem on our side, or you're charged twice, we'll refund it.</li>
      </ul>

      <h2 class="h-3">8. About AI results</h2>
      <p>AI-generated images can vary. A headshot may not look exactly like you, or may contain small flaws. Our quality check holds back frames that don't pass for likeness and polish, and retries are free, but it can't catch everything. Please look at each headshot before you use it. You decide which headshots to use and how.</p>

      <h2 class="h-3">9. Our service and brand</h2>
      <p>The Keeper Headshots website, software, name, logo and designs belong to us. These terms don't give you any rights in them apart from using the service. If you send us ideas or feedback, we can use them without owing you anything.</p>

      <h2 class="h-3">10. Disclaimers</h2>
      <p>We work hard to keep Keeper Headshots running well, but the service is provided "as is" and "as available." To the extent the law allows, we make no warranties beyond those in these terms. This includes warranties that the service will always be available or error-free, or that it will meet a particular need.</p>

      <h2 class="h-3">11. Limitation of liability</h2>
      <p>To the extent the law allows, we aren't liable for indirect, incidental, special or consequential losses, or for lost profits, data or opportunities. Our total liability for any claim about the service is limited to the greater of what you paid us in the 12 months before the claim or US$50. Some places don't allow these limits, so they may not all apply to you.</p>

      <h2 class="h-3">12. Responsibility for your content</h2>
      <p>If someone makes a claim against us because of photos you uploaded or how you used the service in breach of these terms, you agree to cover our reasonable costs of dealing with it.</p>

      <h2 class="h-3">13. Ending your use</h2>
      <p>You can stop using Keeper Headshots at any time and delete your account on your <a class="link" href="/app/account" data-link>Account page</a>, or ask us at ${mail}. We may suspend or close your account if you break these terms, or stop offering the service with reasonable notice. If we stop the service entirely, we'll refund shoots you've paid for and haven't used. Sections 5, 9, 10, 11, 12 and 15 continue to apply after your account closes.</p>

      <h2 class="h-3">14. Changes</h2>
      <p>We may update the service and these terms. If we make an important change to the terms, we'll update the date at the top and email you before it takes effect. If you keep using the service after that, the new terms apply.</p>

      <h2 class="h-3">15. Law and disputes</h2>
      <p>These terms are governed by the laws of the State of Iowa, USA. If something goes wrong, please contact us first. Most problems can be sorted out quickly. Any dispute that we can't resolve will be decided by the state or federal courts in Polk County, Iowa, unless the law where you live gives you the right to bring it locally. Either of us can use small-claims court where it's available.</p>

      <h2 class="h-3">16. Contact</h2>
      <p>Questions about these terms: ${mail}, or use our <a class="link" href="/contact" data-link>contact form</a>.</p>`,
  }).v;
}
