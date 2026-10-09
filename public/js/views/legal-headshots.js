import { html, icon, raw, state, example } from "../core.js";
import { LEGAL_FAQ } from "../shared/faq.js";
import { footer } from "./landing.js";

// /lawyer-headshots: search landing page for "lawyer headshots" / attorney
// headshots. Its FAQ also feeds the page's structured data (lib/seo.js).
// Shares the re-* layout styles with the real estate page.

// Example attorneys (lib/examples.js LEGAL). Fictional people.
const LOOKS = [
  { id: "lw-1", look: "Library · Suit & Tie", fit: "Litigation and trial practice" },
  { id: "lw-2", look: "Studio Gray · Navy Suit", fit: "Corporate and business law" },
  { id: "lw-3", look: "Glass Office · Charcoal Blazer", fit: "Tech, IP and startup counsel" },
  { id: "lw-4", look: "Studio White · Charcoal Blazer", fit: "Family, estate and immigration law" },
];

// Hero: the portrait on a firm's attorney bio, and the square as a round
// directory or LinkedIn profile photo.
function attorneyKit(id) {
  return html`<div class="re-kit" role="img" aria-label="One headshot used two ways: the 3:4 portrait on a law firm attorney bio and the 1:1 square as a round directory profile photo">
    <div class="re-card md-card">
      <img src="${example(id)}" alt="" loading="eager" />
      <div class="re-card-body">
        <span class="re-card-logo">${icon("scale")}</span>
        <b>Your Name</b>
        <span>Partner · Litigation</span>
        <em class="md-accepting lw-practice">${icon("briefcase")} Commercial disputes</em>
        <i></i><i></i>
      </div>
    </div>
    <p class="re-kit-cap re-kit-cap-card"><b>Portrait 3:4</b><span>Firm bio pages &amp; print</span></p>
    <div class="re-profile">
      <div class="li-circle"><img src="${example(`${id}-sq`)}" alt="" /></div>
      <div class="re-profile-lines"><b>Your Name, Esq.</b><span>Attorney profile · Litigation</span><i></i></div>
    </div>
    <p class="re-kit-cap"><b>Square 1:1</b><span>Directories &amp; LinkedIn</span></p>
  </div>`;
}

const USES = [
  ["globe", "Your firm's attorney bio", "portrait", "The page prospective clients read before they call. A polished portrait makes the first impression for you."],
  ["search-check", "Legal directories and review sites", "square", "Directory and review profiles often show your photo square or round. The square is framed for both."],
  ["contact-round", "LinkedIn", "square", "Referral sources and in-house counsel look you up. The square fits LinkedIn's round profile photo."],
  ["map-pin", "Google Business Profile", "square", "People searching for a lawyer nearby see your photo next to your reviews."],
  ["mic", "CLE, panels and speaking", "portrait", "Speaker bios, conference programs and webinar pages."],
  ["newspaper", "Articles and press releases", "portrait", "Bylines, client alerts, and announcements of new partners and lateral hires."],
];

export function renderLegal({ root }) {
  const cta = state.user ? "/app/new" : "/signup";
  root.innerHTML = html`
  <main id="main">
    <section class="hero re-hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>Lawyer &amp; attorney headshots</p>
          <h1 class="display h-hero" data-reveal style="--i:1">Attorney headshots that <em>build trust.</em></h1>
          <p class="lede" data-reveal style="--i:2">A polished, professional headshot for your firm bio, legal directories and LinkedIn, from a few selfies. Choose a suit and tie, a classic law-library backdrop, or a modern office, with no photographer to schedule around court.</p>
          <div class="hero-ctas" data-reveal style="--i:3">
            <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your headshot ${icon("arrow-right")}</a>
            <a class="btn btn-ghost btn-lg" href="#looks">See the looks</a>
          </div>
          <div class="hero-proof" data-reveal style="--i:4">
            <div class="proof-item"><strong class="tabular">&lt; 15 min</strong><span>from selfies to headshot</span></div>
            <div class="proof-item"><strong class="tabular">Free</strong><span>preview shoot</span></div>
            <div class="proof-item"><strong class="tabular">From $8.99</strong><span>one-time, no subscription</span></div>
          </div>
        </div>
        <div class="hero-visual" data-reveal style="--i:2">${attorneyKit("lw-1")}</div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Where clients see you</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Clients meet your photo <em>before</em> they meet you.</h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Most people research a lawyer online before they call. A confident, current headshot on every profile tells them you're established and approachable.</p>
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

    <section class="section inverse" id="looks">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Looks for law firms</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">From the law library to <em>the modern firm.</em></h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Choose Suit &amp; Tie, Navy Suit or Charcoal Blazer, with a Library, Studio Gray, Studio White or Glass Office backdrop. Try up to four looks in one shoot.</p>
        </div>
        <div class="re-looks">
          ${LOOKS.map(
            (l, i) => html`<figure class="re-look" data-reveal style="--i:${i}">
              <div class="print"><img src="${example(l.id)}" alt="Example attorney headshot: ${l.look}" loading="lazy" /></div>
              <figcaption><b>${l.look}</b><span>${l.fit}</span></figcaption>
            </figure>`,
          )}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container li-guide">
        <div>
          <p class="eyebrow" data-reveal>What makes a strong attorney headshot</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Six things clients notice.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">People hire lawyers they trust. Your photo should say composed, capable and easy to talk to.</p>
        </div>
        <ol class="li-tips">
          ${[
            ["Confident, not stern", "A calm expression with a slight smile reads as capable and approachable."],
            ["It looks like you today", "Clients should recognize you at the first consultation or in court."],
            ["Dressed for the courtroom or the boardroom", "A dark suit, with a tie if you'd wear one to court; a blazer for a modern practice."],
            ["A background that fits your firm", "Bookshelves for a classic practice, a clean studio or bright office for a modern one."],
            ["Matching across the firm", "Every attorney in the same look makes your people pages feel like one firm."],
            ["Within your bar's rules", "Lawyer advertising is regulated by state bars. Use an accurate, current photo of yourself."],
          ].map(([t, d], i) => html`<li data-reveal style="--i:${i % 3}"><span class="li-no">${String(i + 1).padStart(2, "0")}</span><div><b>${t}</b><span>${d}</span></div></li>`)}
        </ol>
      </div>
    </section>

    <section class="section-tight" style="padding-top:0">
      <div class="container">
        <div class="re-team" data-reveal>
          <div>
            <p class="eyebrow">Law firms</p>
            <h2 class="display h-2" style="margin-top:12px">Every attorney, one matching look.</h2>
            <p>Give partners, associates and staff the same backdrop and attire for consistent people pages, including laterals and new associates who join later. About $4 a person with the Executive package.</p>
          </div>
          <a class="btn btn-ink btn-lg" href="/team-headshots" data-link>Team headshots ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container faq">
        <div>
          <p class="eyebrow" data-reveal>Attorney headshot FAQ</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Questions, answered.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">More in our <a class="link" href="/#faq">main FAQ</a>, or <a class="link" href="/contact" data-link>contact us</a>.</p>
        </div>
        <div class="faq-list">
          ${LEGAL_FAQ.map(([q, a], i) => html`<details data-reveal style="--i:${i % 3}" ${i === 0 ? raw("open") : ""}><summary>${q}${icon("chevron-down")}</summary><p>${a}</p></details>`)}
        </div>
      </div>
    </section>

    <section class="section-tight">
      <div class="container">
        <div class="cta-band">
          <div>
            <p class="eyebrow" style="color:#a9b1bd">Free preview · keep yours from $8.99</p>
            <h2 class="display h-1" style="margin-top:16px">Make your first impression before the consultation.</h2>
          </div>
          <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your headshot ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>
  </main>
  ${footer()}`.v;
}
