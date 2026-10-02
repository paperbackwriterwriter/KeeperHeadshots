import { html, icon, raw, state, example } from "../core.js";
import { RESUME_FAQ } from "../shared/faq.js";
import { footer } from "./landing.js";

// /resume-headshots: search landing page for "résumé headshots" / "CV photo".
// Its FAQ also feeds the page's structured data (lib/seo.js). Shares the
// re-* layout styles with the real estate page.

// Example job seekers (lib/examples.js RESUME). Fictional people.
const LOOKS = [
  { id: "cv-1", look: "Studio White · Charcoal Blazer", fit: "Graduates and first jobs" },
  { id: "cv-2", look: "Studio Gray · Navy Suit", fit: "Finance, law and consulting" },
  { id: "cv-3", look: "Glass Office · Charcoal Blazer", fit: "Management and career changers" },
  { id: "cv-4", look: "Studio White · Smart Casual", fit: "Tech and creative roles" },
];

// Hero: the portrait in a CV's photo box, and the square as a round
// profile photo.
function cvKit(id) {
  return html`<div class="re-kit" role="img" aria-label="One headshot used two ways: the 3:4 portrait in a CV's photo box and the 1:1 square as a round profile photo">
    <div class="cv-sheet">
      <div class="cv-head">
        <img src="${example(id)}" alt="" loading="eager" />
        <div><b>Your Name</b><span>Marketing coordinator</span><i></i><i></i></div>
      </div>
      <p class="cv-label">Experience</p><i></i><i></i><i class="short"></i>
      <p class="cv-label">Education</p><i></i><i class="short"></i>
    </div>
    <p class="re-kit-cap re-kit-cap-card"><b>Portrait 3:4</b><span>CV and résumé photo box</span></p>
    <div class="re-profile">
      <div class="li-circle"><img src="${example(`${id}-sq`)}" alt="" /></div>
      <div class="re-profile-lines"><b>Your Name</b><span>Open to new roles</span><i></i></div>
    </div>
    <p class="re-kit-cap"><b>Square 1:1</b><span>LinkedIn &amp; job-site profiles</span></p>
  </div>`;
}

const USES = [
  ["file-user", "Your CV or résumé", "portrait", "A head-and-shoulders portrait that fits the photo box in most CV templates, for countries where a photo is expected."],
  ["contact-round", "LinkedIn", "square", "Recruiters look you up after reading your application. The square is framed for LinkedIn's round profile photo."],
  ["search-check", "Job sites and application portals", "square", "Many job boards and applicant profiles ask for a profile photo, shown square or round."],
  ["globe", "Portfolio or personal website", "portrait", "A polished portrait for your About section, portfolio or speaker bio."],
  ["video", "Video interviews", "square", "Set it as your Zoom or Microsoft Teams profile photo, so you look professional before the camera turns on."],
  ["mail", "Email signature", "square", "A small, friendly photo next to your name on every follow-up and thank-you email."],
];

export function renderResume({ root }) {
  const cta = state.user ? "/app/new" : "/signup";
  root.innerHTML = html`
  <main id="main">
    <section class="hero re-hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>Résumé &amp; CV headshots</p>
          <h1 class="display h-hero" data-reveal style="--i:1">A professional headshot for <em>your job search.</em></h1>
          <p class="lede" data-reveal style="--i:2">Turn a few selfies into a polished, professional photo for your CV, LinkedIn profile and job applications. Download a 3:4 portrait for CV photo boxes, a 1:1 square for LinkedIn and job sites, or both. Ready in minutes, not days.</p>
          <div class="hero-ctas" data-reveal style="--i:3">
            <a class="btn btn-flash btn-lg" href="${cta}" data-link><span>Create your <span class="nowrap">job-search</span> headshot</span> ${icon("arrow-right")}</a>
            <a class="btn btn-ghost btn-lg" href="#photo-or-not">Photo on a résumé?</a>
          </div>
          <div class="hero-proof" data-reveal style="--i:4">
            <div class="proof-item"><strong class="tabular">Minutes</strong><span>from selfies to headshot</span></div>
            <div class="proof-item"><strong class="tabular">Free</strong><span>first shoot</span></div>
            <div class="proof-item"><strong class="tabular">From $29.99</strong><span>one-time, no subscription</span></div>
          </div>
        </div>
        <div class="hero-visual" data-reveal style="--i:2">${cvKit("cv-1")}</div>
      </div>
    </section>

    <section class="section" id="photo-or-not" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Photo or no photo?</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">It depends on <em>where you apply.</em></h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Customs differ around the world. Wherever you apply, recruiters will see your LinkedIn photo, so a good headshot matters either way.</p>
        </div>
        <div class="cv-where">
          <article class="li-card" data-reveal style="--i:0">
            <span class="li-ic">${icon("check")}</span>
            <h3 class="h-4">Usually included</h3>
            <p>Much of continental Europe, including Germany, Austria, Switzerland, France and Spain, and countries such as Japan and South Korea. A professional CV photo is common or expected.</p>
            <span class="re-fmt re-fmt-portrait"><i aria-hidden="true"></i>Portrait 3:4 on your CV</span>
          </article>
          <article class="li-card" data-reveal style="--i:1">
            <span class="li-ic">${icon("x")}</span>
            <h3 class="h-4">Usually left off</h3>
            <p>The US, UK, Canada, Ireland and Australia. Résumés normally go without a photo, and many employers prefer it that way. Put your headshot on LinkedIn instead.</p>
            <span class="re-fmt re-fmt-square"><i aria-hidden="true"></i>Square 1:1 on LinkedIn</span>
          </article>
        </div>
        <p class="small muted cv-note" data-reveal>Always follow the job listing: if it asks you not to include a photo, leave it off.</p>
      </div>
    </section>

    <section class="section inverse">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Where you'll use it</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">One headshot for your <em>whole</em> job search.</h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Every headshot comes as a portrait and a square, ready to use with no cropping. Choose which your download buttons give you, and switch any time.</p>
        </div>
        <div class="li-cards re-uses cv-uses">
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

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Looks for your field</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Dress for the job <em>you're applying for.</em></h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Pick a backdrop and outfit that suit your industry. Try up to four looks in one shoot and keep your favorite.</p>
        </div>
        <div class="re-looks">
          ${LOOKS.map(
            (l, i) => html`<figure class="re-look" data-reveal style="--i:${i}">
              <div class="print"><img src="${example(l.id)}" alt="Example job-search headshot: ${l.look}" loading="lazy" /></div>
              <figcaption><b>${l.look}</b><span>${l.fit}</span></figcaption>
            </figure>`,
          )}
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container li-guide">
        <div>
          <p class="eyebrow" data-reveal>What makes a strong CV photo</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Six things recruiters notice.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">Your photo is a first impression before anyone has read a word. These basics are built into every Keeper headshot.</p>
        </div>
        <ol class="li-tips">
          ${[
            ["It looks like you today", "Your interviewer should recognize you the moment you walk in or join the call."],
            ["Head and shoulders", "Your face should fill most of the frame, with no hobbies, holidays or cropped-out friends."],
            ["A neutral background", "A plain studio backdrop or a softly blurred office keeps attention on you."],
            ["Dressed for the role", "One step above the everyday dress code of the job you want."],
            ["Confident and approachable", "A relaxed, natural smile and direct eye contact."],
            ["The same photo everywhere", "Use one headshot on your CV, LinkedIn and job-site profiles so recruiters connect the dots."],
          ].map(([t, d], i) => html`<li data-reveal style="--i:${i % 3}"><span class="li-no">${String(i + 1).padStart(2, "0")}</span><div><b>${t}</b><span>${d}</span></div></li>`)}
        </ol>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container faq">
        <div>
          <p class="eyebrow" data-reveal>Résumé headshot FAQ</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Questions, answered.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">More in our <a class="link" href="/#faq">main FAQ</a>, and see <a class="link" href="/linkedin-headshots" data-link>LinkedIn headshots</a> for your profile photo.</p>
        </div>
        <div class="faq-list">
          ${RESUME_FAQ.map(([q, a], i) => html`<details data-reveal style="--i:${i % 3}" ${i === 0 ? raw("open") : ""}><summary>${q}${icon("chevron-down")}</summary><p>${a}</p></details>`)}
        </div>
      </div>
    </section>

    <section class="section-tight">
      <div class="container">
        <div class="cta-band">
          <div>
            <p class="eyebrow" style="color:#a9b1bd">Free preview shoot · from $29.99</p>
            <h2 class="display h-1" style="margin-top:16px">Your next application deserves a better photo.</h2>
          </div>
          <a class="btn btn-flash btn-lg" href="${cta}" data-link><span>Create your <span class="nowrap">job-search</span> headshot</span> ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>
  </main>
  ${footer()}`.v;
}
