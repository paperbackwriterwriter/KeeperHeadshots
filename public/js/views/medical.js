import { html, icon, raw, state, example } from "../core.js";
import { MEDICAL_FAQ } from "../shared/faq.js";
import { footer } from "./landing.js";

// /doctor-headshots: search landing page for "doctor headshots" / medical
// and physician headshots. Its FAQ also feeds the page's structured data
// (lib/seo.js). Shares the re-* layout styles with the real estate page.

// Example clinicians (lib/examples.js MEDICAL). Fictional people.
const LOOKS = [
  { id: "md-1", look: "Glass Office · White Coat", fit: "Physicians and primary care" },
  { id: "md-2", look: "Studio Gray · White Coat", fit: "Specialists and surgeons" },
  { id: "md-3", look: "Glass Office · Medical Scrubs", fit: "Nurses, PAs and care teams" },
  { id: "md-4", look: "Studio White · Charcoal Blazer", fit: "Dentists, therapists, private practice" },
];

// Hero: the portrait on a "find a doctor" profile, and the square as a round
// telehealth profile photo.
function doctorKit(id) {
  return html`<div class="re-kit" role="img" aria-label="One headshot used two ways: the 3:4 portrait on a provider profile page and the 1:1 square as a round telehealth profile photo">
    <div class="re-card md-card">
      <img src="${example(id)}" alt="" loading="eager" />
      <div class="re-card-body">
        <span class="re-card-logo">${icon("stethoscope")}</span>
        <b>Dr. Your Name</b>
        <span>Family medicine</span>
        <em class="md-accepting">${icon("calendar-check")} Accepting new patients</em>
        <i></i><i></i>
      </div>
    </div>
    <p class="re-kit-cap re-kit-cap-card"><b>Portrait 3:4</b><span>Provider pages &amp; directories</span></p>
    <div class="re-profile">
      <div class="li-circle"><img src="${example(`${id}-sq`)}" alt="" /></div>
      <div class="re-profile-lines"><b>Dr. Your Name</b><span>Video visit · Today 2:30 pm</span><i></i></div>
    </div>
    <p class="re-kit-cap"><b>Square 1:1</b><span>Telehealth &amp; booking profiles</span></p>
  </div>`;
}

const USES = [
  ["globe", "Practice or hospital website", "portrait", "A polished portrait for your provider profile, the page patients read before choosing you."],
  ["search-check", "Doctor directories and booking sites", "square", "Directory and booking profiles often show your photo square or round. The square is framed for both."],
  ["map-pin", "Google Business Profile", "square", "Patients searching nearby see your photo next to your reviews and opening hours."],
  ["video", "Telehealth profiles", "square", "A friendly face in the waiting room, before the video visit starts."],
  ["mic", "Conferences and publications", "portrait", "Speaker bios, conference programs, author pages and grant applications."],
  ["contact-round", "LinkedIn and professional networks", "square", "Round profile photos on LinkedIn and physician networks, uploaded as they are."],
];

export function renderMedical({ root }) {
  const cta = state.user ? "/app/new" : "/signup";
  root.innerHTML = html`
  <main id="main">
    <section class="hero re-hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>Doctor &amp; medical headshots</p>
          <h1 class="display h-hero" data-reveal style="--i:1">Doctor headshots patients <em>trust.</em></h1>
          <p class="lede" data-reveal style="--i:2">A warm, professional headshot for your provider profile, directories and telehealth, from a few selfies. Choose a white coat, scrubs or business attire, and skip booking a photographer between patients.</p>
          <div class="hero-ctas" data-reveal style="--i:3">
            <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your headshot ${icon("arrow-right")}</a>
            <a class="btn btn-ghost btn-lg" href="#looks">See the looks</a>
          </div>
          <div class="hero-proof" data-reveal style="--i:4">
            <div class="proof-item"><strong class="tabular">&lt; 15 min</strong><span>from selfies to headshot</span></div>
            <div class="proof-item"><strong class="tabular">Free</strong><span>first shoot</span></div>
            <div class="proof-item"><strong class="tabular">From $8.99</strong><span>one-time, no subscription</span></div>
          </div>
        </div>
        <div class="hero-visual" data-reveal style="--i:2">${doctorKit("md-1")}</div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Where patients see you</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Your first impression happens <em>online.</em></h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Patients often choose a provider from a profile page or a search result. A clear, friendly headshot helps them feel they already know you.</p>
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
            <p class="eyebrow" data-reveal>White coat, scrubs or business</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Dressed the way <em>patients know you.</em></h2>
          </div>
          <p class="lede" data-reveal style="--i:2">White Coat and Medical Scrubs are wardrobe options, so there's no need to wear them in your selfies. Every headshot comes without names, logos or badges.</p>
        </div>
        <div class="re-looks">
          ${LOOKS.map(
            (l, i) => html`<figure class="re-look" data-reveal style="--i:${i}">
              <div class="print"><img src="${example(l.id)}" alt="Example medical headshot: ${l.look}" loading="lazy" /></div>
              <figcaption><b>${l.look}</b><span>${l.fit}</span></figcaption>
            </figure>`,
          )}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container li-guide">
        <div>
          <p class="eyebrow" data-reveal>What makes a great provider headshot</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Six things patients notice.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">Patients are choosing someone to trust with their health. Your photo should feel calm, competent and kind.</p>
        </div>
        <ol class="li-tips">
          ${[
            ["A warm, reassuring smile", "Approachable matters more than serious. Kind eyes put nervous patients at ease."],
            ["It looks like you today", "Patients should recognize you when you walk into the exam room."],
            ["Attire that matches your role", "A white coat, scrubs or business attire, whichever patients will see you in."],
            ["A clean, calm background", "A bright office or plain studio backdrop, with no clutter or equipment."],
            ["The same photo everywhere", "Your website, directories and booking profiles should all show the same face."],
            ["Your organization's guidelines", "Many hospitals and health systems have photo standards. Check yours before you upload."],
          ].map(([t, d], i) => html`<li data-reveal style="--i:${i % 3}"><span class="li-no">${String(i + 1).padStart(2, "0")}</span><div><b>${t}</b><span>${d}</span></div></li>`)}
        </ol>
      </div>
    </section>

    <section class="section-tight" style="padding-top:0">
      <div class="container">
        <div class="re-team" data-reveal>
          <div>
            <p class="eyebrow">Practices and clinics</p>
            <h2 class="display h-2" style="margin-top:12px">Every provider, one matching look.</h2>
            <p>Give every clinician the same backdrop and attire for consistent provider pages, including locums and new hires. About $4 a person with the Executive package.</p>
          </div>
          <a class="btn btn-ink btn-lg" href="/team-headshots" data-link>Team headshots ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container faq">
        <div>
          <p class="eyebrow" data-reveal>Medical headshot FAQ</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Questions, answered.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">More in our <a class="link" href="/#faq">main FAQ</a>, or <a class="link" href="/contact" data-link>contact us</a>.</p>
        </div>
        <div class="faq-list">
          ${MEDICAL_FAQ.map(([q, a], i) => html`<details data-reveal style="--i:${i % 3}" ${i === 0 ? raw("open") : ""}><summary>${q}${icon("chevron-down")}</summary><p>${a}</p></details>`)}
        </div>
      </div>
    </section>

    <section class="section-tight">
      <div class="container">
        <div class="cta-band">
          <div>
            <p class="eyebrow" style="color:#a9b1bd">Free preview · keep yours from $8.99</p>
            <h2 class="display h-1" style="margin-top:16px">Put a friendly face on your practice.</h2>
          </div>
          <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your headshot ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>
  </main>
  ${footer()}`.v;
}
