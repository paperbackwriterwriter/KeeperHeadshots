import { html, icon, raw, state, example } from "../core.js";
import { LINKEDIN_FAQ } from "../shared/faq.js";
import { footer } from "./landing.js";

// /linkedin-headshots: search landing page for "LinkedIn headshots".
// Its FAQ also feeds the page's structured data (lib/seo.js).

const LOOKS = [
  { id: "strip-1", look: "Studio Gray · Navy Suit", fit: "Finance, law, consulting" },
  { id: "strip-2", look: "Glass Office · Charcoal Blazer", fit: "Tech, sales, management" },
  { id: "strip-4", look: "Library · Black Turtleneck", fit: "Creative, academic, advisory" },
];

// Shows the two deliverables: the 3:4 portrait and the 1:1 square (the
// example's "-sq" version, widened for a circle like customers' squares).
function deliverables(id) {
  return html`<div class="li-deliverables" role="img" aria-label="One headshot delivered two ways: a 3:4 portrait and a 1:1 square shown in a round profile frame">
    <figure class="print li-portrait">
      <img src="${example(id)}" alt="" loading="eager" />
      <figcaption class="print-cap"><b>Portrait</b><span>3:4 · full resolution</span></figcaption>
    </figure>
    <div class="li-square">
      <div class="li-square-frame"><img src="${example(`${id}-sq`)}" alt="" /></div>
      <div class="li-circle"><img src="${example(`${id}-sq`)}" alt="" /></div>
      <p class="li-square-cap"><b>Square 1:1</b><span>Ready for LinkedIn &amp; Teams</span></p>
    </div>
  </div>`;
}

export function renderLinkedIn({ root }) {
  const cta = state.user ? "/app/new" : "/signup";
  root.innerHTML = html`
  <main id="main">
    <section class="hero li-hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>LinkedIn headshots</p>
          <h1 class="display h-hero" data-reveal style="--i:1">LinkedIn headshots, <em>ready to upload.</em></h1>
          <p class="lede" data-reveal style="--i:2">Turn a few selfies into a professional LinkedIn photo. Every headshot arrives ready for immediate use, with a perfectly square 1:1 crop made for LinkedIn and Microsoft Teams. No cropping, no resizing, no guessing how it will look in the circle.</p>
          <div class="hero-ctas" data-reveal style="--i:3">
            <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your LinkedIn headshot ${icon("arrow-right")}</a>
            <a class="btn btn-ghost btn-lg" href="#ready">What you get</a>
          </div>
          <div class="hero-proof" data-reveal style="--i:4">
            <div class="proof-item"><strong class="tabular">1:1</strong><span>square for LinkedIn &amp; Teams</span></div>
            <div class="proof-item"><strong class="tabular">Free</strong><span>first shoot</span></div>
            <div class="proof-item"><strong class="tabular">From $8.99</strong><span>one-time, no subscription</span></div>
          </div>
        </div>
        <div class="hero-visual" data-reveal style="--i:2">${deliverables("strip-2")}</div>
      </div>
    </section>

    <section class="section" id="ready" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Ready for immediate use</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Download it, upload it, <em>done.</em></h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Most headshots still need work before they go on your profile. Yours don't. Each one is finished, checked and sized before you download it.</p>
        </div>
        <div class="li-cards">
          <article class="li-card" data-reveal style="--i:0">
            <span class="li-ic">${icon("focus")}</span>
            <h3 class="h-4">A perfect 1:1 square for LinkedIn and Teams</h3>
            <p>LinkedIn and Microsoft Teams put a circular mask over your square photo, so its four corners are cut away completely. Your square is framed for that circle: face centered, with breathing room above your hair and around your shoulders so nothing gets awkwardly clipped. Upload it as it is.</p>
          </article>
          <article class="li-card" data-reveal style="--i:1">
            <span class="li-ic">${icon("download")}</span>
            <h3 class="h-4">A full-resolution portrait too</h3>
            <p>Every headshot also comes as a 3:4 portrait for your résumé, company website, speaker bio or print. Both versions download together, so you have the right shape for everywhere you need it.</p>
          </article>
          <article class="li-card" data-reveal style="--i:2">
            <span class="li-ic">${icon("badge-check")}</span>
            <h3 class="h-4">Checked before you see it</h3>
            <p>Every headshot is compared with your own photos for likeness and inspected for polish. Anything that falls short is retaken automatically, then the set is graded so you know which one to use.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section inverse">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Looks that work on LinkedIn</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Dress for the job <em>you want.</em></h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Pick the backdrop and outfit that fit your field. Try a few looks in one shoot and keep your favorite.</p>
        </div>
        <div class="li-looks">
          ${LOOKS.map(
            (l, i) => html`<figure class="li-look" data-reveal style="--i:${i}">
              <div class="li-look-sq"><img src="${example(`${l.id}-sq`)}" alt="Example LinkedIn headshot: ${l.look}" loading="lazy" /></div>
              <figcaption><b>${l.look}</b><span>${l.fit}</span></figcaption>
            </figure>`,
          )}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container li-guide">
        <div>
          <p class="eyebrow" data-reveal>What makes a great LinkedIn photo</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Six things every good one gets right.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">Your photo is the first thing people see on your profile, in search results and next to every message and comment. These are the basics, and every Keeper headshot is built around them.</p>
        </div>
        <ol class="li-tips">
          ${[
            ["Your face fills the frame", "Head and shoulders, with your face taking up most of the circle. Full-body and group shots don't read at thumbnail size."],
            ["It looks like you today", "A recent, true likeness builds trust when you meet in person or on a video call."],
            ["Friendly eye contact", "Look into the camera with a relaxed, natural expression."],
            ["A clean background", "A plain studio backdrop or a softly blurred office keeps attention on you."],
            ["The right outfit for your field", "One step above what you wear day to day, in solid, mid-tone colors."],
            ["Centered, with breathing room", "LinkedIn masks your square photo with a circle, so the four corners disappear. Keep your face centered with space around your hair and shoulders, at 400 × 400 pixels or larger."],
          ].map(([t, d], i) => html`<li data-reveal style="--i:${i % 3}"><span class="li-no">${String(i + 1).padStart(2, "0")}</span><div><b>${t}</b><span>${d}</span></div></li>`)}
        </ol>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="li-howto">
          <div>
            <p class="eyebrow" data-reveal>Updating your photo</p>
            <h2 class="display h-2" data-reveal style="--i:1;margin-top:16px">Two minutes from download to profile.</h2>
          </div>
          <div class="li-howto-cols">
            <div data-reveal style="--i:1">
              <h3 class="h-4">On LinkedIn</h3>
              <ol>
                <li>Go to your profile and select your profile photo.</li>
                <li>Choose to add or change your photo, then upload the <b>square</b> file.</li>
                <li>It's already framed, so there's no need to zoom or reposition. Just save.</li>
              </ol>
            </div>
            <div data-reveal style="--i:2">
              <h3 class="h-4">In Microsoft Teams</h3>
              <ol>
                <li>Select your profile picture at the top of Teams.</li>
                <li>Choose to change your picture and upload the same <b>square</b> file.</li>
                <li>Save. It also appears in Outlook and across Microsoft 365 for most work accounts.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container faq">
        <div>
          <p class="eyebrow" data-reveal>LinkedIn headshot FAQ</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Questions, answered.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">More in our <a class="link" href="/#faq">main FAQ</a>, or <a class="link" href="/contact" data-link>contact us</a>.</p>
        </div>
        <div class="faq-list">
          ${LINKEDIN_FAQ.map(([q, a], i) => html`<details data-reveal style="--i:${i % 3}" ${i === 0 ? raw("open") : ""}><summary>${q}${icon("chevron-down")}</summary><p>${a}</p></details>`)}
        </div>
      </div>
    </section>

    <section class="section-tight">
      <div class="container">
        <div class="cta-band">
          <div>
            <p class="eyebrow" style="color:#a9b1bd">Free preview · keep yours from $8.99</p>
            <h2 class="display h-1" style="margin-top:16px">Your new LinkedIn photo is a few selfies away.</h2>
          </div>
          <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your LinkedIn headshot ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>
  </main>
  ${footer()}`.v;
}
