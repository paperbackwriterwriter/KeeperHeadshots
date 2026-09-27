import { html, icon, raw, state, example } from "../core.js";
import { REAL_ESTATE_FAQ } from "../shared/faq.js";
import { footer } from "./landing.js";

// /real-estate-headshots: search landing page for "real estate headshots" /
// realtor headshots. Its FAQ also feeds the page's structured data (lib/seo.js).

// Example agents (lib/examples.js REAL_ESTATE). Fictional people.
const LOOKS = [
  { id: "re-1", look: "City Terrace · Navy Suit", fit: "Luxury and city listings" },
  { id: "re-2", look: "Glass Office · Charcoal Blazer", fit: "Brokerage and commercial" },
  { id: "re-3", look: "Botanical · Crisp White Shirt", fit: "Residential and family homes" },
  { id: "re-4", look: "Studio White · Smart Casual", fit: "Clean and bright for print" },
];

// Hero: the same headshot on a business card (portrait) and as a round
// listing-profile photo (the square).
function agentKit(id) {
  return html`<div class="re-kit" role="img" aria-label="One headshot used two ways: the 3:4 portrait on a business card and the 1:1 square as a round agent profile photo">
    <div class="re-card">
      <img src="${example(id)}" alt="" loading="eager" />
      <div class="re-card-body">
        <span class="re-card-logo">${icon("house")}</span>
        <b>Your Name</b>
        <span>Real estate agent</span>
        <i></i><i></i><i></i>
      </div>
    </div>
    <p class="re-kit-cap re-kit-cap-card"><b>Portrait 3:4</b><span>Business cards, signs, flyers</span></p>
    <div class="re-profile">
      <div class="li-circle"><img src="${example(`${id}-sq`)}" alt="" /></div>
      <div class="re-profile-lines"><b>Your Name</b><span>Listing agent · Your city</span><i></i></div>
    </div>
    <p class="re-kit-cap"><b>Square 1:1</b><span>Listing sites &amp; social profiles</span></p>
  </div>`;
}

const USES = [
  ["id-card", "Business cards and flyers", "portrait", "A crisp, full-resolution portrait for business cards, postcards, flyers and listing brochures."],
  ["signpost", "Yard signs and sign riders", "portrait", "A clean background and even light that still read clearly from the curb."],
  ["house", "Listing sites and your brokerage profile", "square", "Agent photos on listing sites and brokerage directories are often shown square or round. The square is framed for both."],
  ["share-2", "Social media and ads", "square", "Profile photos on Facebook, Instagram and LinkedIn are round, so upload the square as it is."],
  ["globe", "Your website's About page", "portrait", "A polished portrait that makes your bio page feel professional and personal."],
  ["mail", "Email signature", "square", "A small square photo next to your name, so clients put a face to every email."],
];

export function renderRealEstate({ root }) {
  const cta = state.user ? "/app/new" : "/signup";
  root.innerHTML = html`
  <main id="main">
    <section class="hero re-hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>Real estate headshots</p>
          <h1 class="display h-hero" data-reveal style="--i:1">Real estate headshots clients <em>remember.</em></h1>
          <p class="lede" data-reveal style="--i:2">Look approachable and trustworthy on your business cards, yard signs, listings and social media. Upload a few selfies and get studio-quality headshots in minutes, ready as a print-ready portrait, a 1:1 square for profile photos, or both.</p>
          <div class="hero-ctas" data-reveal style="--i:3">
            <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your agent headshot ${icon("arrow-right")}</a>
            <a class="btn btn-ghost btn-lg" href="#formats">Portrait or square?</a>
          </div>
          <div class="hero-proof" data-reveal style="--i:4">
            <div class="proof-item"><strong class="tabular">3:4 + 1:1</strong><span>portrait, square or both</span></div>
            <div class="proof-item"><strong class="tabular">Free</strong><span>first shoot</span></div>
            <div class="proof-item"><strong class="tabular">From $29</strong><span>one-time, no subscription</span></div>
          </div>
        </div>
        <div class="hero-visual" data-reveal style="--i:2">${agentKit("re-1")}</div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Where your headshot goes</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">One headshot. <em>Every</em> place clients look.</h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Your face is on more of your marketing than anything else. Use the same headshot everywhere and people start to recognize you before you've even met.</p>
        </div>
        <div class="li-cards re-uses">
          ${USES.map(
            ([ic, t, fmt, d], i) => html`<article class="li-card" data-reveal style="--i:${i % 3}">
              <span class="li-ic">${icon(ic)}</span>
              <h3 class="h-4">${t}</h3>
              <p>${d}</p>
              <span class="re-fmt re-fmt-${fmt}"><i aria-hidden="true"></i>${fmt === "square" ? "Square 1:1" : "Portrait 3:4"}</span>
            </article>`,
          )}
        </div>
      </div>
    </section>

    <section class="section inverse" id="formats">
      <div class="container re-formats">
        <div>
          <p class="eyebrow" data-reveal>Your format, your choice</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Portrait, square, <em>or both.</em></h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">Every headshot comes in both shapes, ready to use with no cropping. Choose which one your download buttons give you, and switch any time.</p>
          <ul class="re-format-list" data-reveal style="--i:3">
            <li><b>Portrait 3:4</b><span>Full resolution, for print, signs and your website.</span></li>
            <li><b>Square 1:1</b><span>Framed for round profile photos: face centered, with room around your hair and shoulders.</span></li>
            <li><b>Both</b><span>Each headshot as a portrait and a square, side by side.</span></li>
          </ul>
        </div>
        <div class="re-shapes" data-reveal style="--i:2">
          <figure class="print"><img src="${example("re-2")}" alt="Example agent headshot as a 3:4 portrait" loading="lazy" /><figcaption class="print-cap"><b>Portrait</b><span>3:4</span></figcaption></figure>
          <figure class="print re-shape-sq"><img src="${example("re-2-sq")}" alt="The same headshot as a 1:1 square" loading="lazy" /><figcaption class="print-cap"><b>Square</b><span>1:1</span></figcaption></figure>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Looks for agents</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Match your look to <em>your market.</em></h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Pick the backdrop and outfit that suit the homes you sell. Try up to four looks in one shoot and keep your favorite.</p>
        </div>
        <div class="re-looks">
          ${LOOKS.map(
            (l, i) => html`<figure class="re-look" data-reveal style="--i:${i}">
              <div class="print"><img src="${example(l.id)}" alt="Example real estate headshot: ${l.look}" loading="lazy" /></div>
              <figcaption><b>${l.look}</b><span>${l.fit}</span></figcaption>
            </figure>`,
          )}
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container li-guide">
        <div>
          <p class="eyebrow" data-reveal>What makes a great agent headshot</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Six things clients notice.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">Buyers and sellers are choosing someone to trust with the biggest purchase of their lives. Your headshot is often their first impression.</p>
        </div>
        <ol class="li-tips">
          ${[
            ["A real, warm smile", "Approachable beats serious. A genuine smile with friendly eyes says you're easy to work with."],
            ["It looks like you today", "Clients should recognize you at the first showing. Update your headshot when your look changes."],
            ["Dressed for your clients", "Wear what you'd wear to a listing appointment: a blazer or suit for luxury, smart casual for a relaxed market."],
            ["A background that fits your brand", "A bright office, city view or soft greenery sets the tone without distracting from your face."],
            ["Sharp enough to print", "Business cards, signs and flyers need a crisp, high-resolution photo, not a cropped phone snapshot."],
            ["The same photo everywhere", "Use one headshot across cards, signs, listings and social media so people remember your face."],
          ].map(([t, d], i) => html`<li data-reveal style="--i:${i % 3}"><span class="li-no">${String(i + 1).padStart(2, "0")}</span><div><b>${t}</b><span>${d}</span></div></li>`)}
        </ol>
      </div>
    </section>

    <section class="section-tight" style="padding-top:0">
      <div class="container">
        <div class="re-team" data-reveal>
          <div>
            <p class="eyebrow">Brokerages and teams</p>
            <h2 class="display h-2" style="margin-top:12px">Every agent, one matching look.</h2>
            <p>Give your whole office the same backdrop and dress code for a consistent team page, signs and listings. About $4 an agent with the Executive package.</p>
          </div>
          <a class="btn btn-ink btn-lg" href="/team-headshots" data-link>Team headshots ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container faq">
        <div>
          <p class="eyebrow" data-reveal>Real estate headshot FAQ</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Questions, answered.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">More in our <a class="link" href="/#faq">main FAQ</a>, or <a class="link" href="/contact" data-link>contact us</a>.</p>
        </div>
        <div class="faq-list">
          ${REAL_ESTATE_FAQ.map(([q, a], i) => html`<details data-reveal style="--i:${i % 3}" ${i === 0 ? raw("open") : ""}><summary>${q}${icon("chevron-down")}</summary><p>${a}</p></details>`)}
        </div>
      </div>
    </section>

    <section class="section-tight">
      <div class="container">
        <div class="cta-band">
          <div>
            <p class="eyebrow" style="color:#a9b1bd">First shoot free · from $29 after that</p>
            <h2 class="display h-1" style="margin-top:16px">Your next listing deserves a better headshot.</h2>
          </div>
          <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your agent headshot ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>
  </main>
  ${footer()}`.v;
}
