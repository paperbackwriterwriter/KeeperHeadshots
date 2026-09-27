import { html, icon, raw, greaseCircle, state, logoMark, wordmark, example } from "../core.js";
import { BACKDROPS, OUTFITS, PACKAGES } from "../shared/catalog.js";

const HERO_FRAMES = [
  ["studio-gray", "navy-suit"], ["glass-office", "charcoal-blazer"], ["city-terrace", "camel-knit"],
  ["library", "black-turtleneck"], ["studio-gray", "charcoal-blazer"], ["botanical", "oxford"],
  ["studio-white", "white-shirt"], ["glass-office", "navy-suit"], ["city-terrace", "oxford"],
];

const STRIP = [
  { seed: "s1", backdrop: "studio-gray", outfit: "navy-suit" },
  { seed: "s2", backdrop: "glass-office", outfit: "charcoal-blazer" },
  { seed: "s3", backdrop: "city-terrace", outfit: "camel-knit" },
  { seed: "s4", backdrop: "library", outfit: "black-turtleneck" },
  { seed: "s5", backdrop: "studio-white", outfit: "white-shirt" },
  { seed: "s6", backdrop: "botanical", outfit: "oxford" },
  { seed: "s7", backdrop: "studio-gray", outfit: "charcoal-blazer" },
];

const FAQ = [
  ["What photos should I upload?", "Between one and six recent photos where your face is clearly visible — ideally a mix of angles and expressions, taken in decent light. No sunglasses, group photos or heavy filters. Our AI photo check reviews every upload and tells you exactly what to fix before you spend a cent of rendering time."],
  ["How long does it take?", "Your photo check comes back in seconds. Rendering a shoot usually takes a few minutes; you can watch each frame develop live, then our AI retoucher grades the set and picks your best shot."],
  ["Will the headshots actually look like me?", "Likeness is the whole game. We pass your best reference photos to the image model with strict instructions to preserve your features, and every finished headshot is scored for likeness against your originals. Anything that drifts is flagged as a retake."],
  ["Who owns the photos?", "You do. Use your headshots anywhere — LinkedIn, your company site, print, press kits. We never use your photos to train models or for marketing."],
  ["What if I don't like the results?", "Every paid shoot is covered by our 100% money-back guarantee. If none of your headshots are usable, we'll refund you in full."],
  ["Can I order for my whole team?", "Yes. Each shoot is one person, so a package covers several people: the Executive package includes 12 shoots. Everyone can use the same backdrops and wardrobe so your team page looks consistent. For larger teams, contact us about volume pricing."],
];

export function renderLanding({ root }) {
  const cta = state.user ? "/app/new" : "/signup";
  root.innerHTML = html`
  <main id="main">
    <!-- Hero -->
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>The AI headshot studio</p>
          <h1 class="display h-hero" data-reveal style="--i:1">Professional headshots, <em>without</em> the photo shoot.</h1>
          <p class="lede" data-reveal style="--i:2">Upload a few selfies. Our AI studio checks your photos, develops studio-quality headshots in the looks you choose, then grades every frame so you know exactly which one to use.</p>
          <div class="hero-ctas" data-reveal style="--i:3">
            <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your headshots ${icon("arrow-right")}</a>
            <a class="btn btn-ghost btn-lg" href="/#how">See how it works</a>
          </div>
          <div class="hero-proof" data-reveal style="--i:4">
            <div class="proof-item"><strong class="tabular">&lt; 1 hr</strong><span>typical turnaround</span></div>
            <div class="proof-item"><strong class="tabular">From $29</strong><span>one-time, no subscription</span></div>
            <div class="proof-item"><strong class="tabular">100%</strong><span>money-back guarantee</span></div>
          </div>
        </div>

        <div class="sheet" data-reveal style="--i:2" aria-label="Example: one casual selfie becomes a contact sheet of nine professional headshots of the same person" role="img">
          <div class="sheet-board">
            ${HERO_FRAMES.map(
              ([b, o], i) => html`<div class="sheet-frame ${i === 4 ? "keeper" : ""}">
                <img src="${example(`hero-${i + 1}`)}" alt="" loading="${i < 6 ? "eager" : "lazy"}" />
                <span class="fno">${String(i + 1).padStart(2, "0")}A</span>
                ${i === 4 ? greaseCircle() : ""}
              </div>`,
            )}
          </div>
          <figure class="polaroid">
            <img src="${example("hero-selfie")}" alt="" />
            <figcaption><span>BEFORE</span><span>SELFIE</span></figcaption>
          </figure>
          <span class="tag-keeper">${icon("badge-check")} Best pick <span class="score">96</span></span>
        </div>
      </div>
    </section>

    <!-- Stats -->
    <section class="section-tight" aria-label="Keeper Headshots at a glance">
      <div class="container">
        <div class="stats">
          ${[
            ["3", "AI passes on every shoot"],
            ["4", "Looks per paid shoot"],
            ["< 1 hr", "Typical turnaround"],
            ["$29", "vs. $200+ at a studio"],
          ].map(([n, l], i) => html`<div class="stat" data-reveal style="--i:${i}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`)}
        </div>
      </div>
    </section>

    <!-- How it works -->
    <section class="section" id="how">
      <div class="container steps">
        <div class="steps-sticky">
          <p class="eyebrow" data-reveal>How it works</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">From camera roll to <em>corner office</em> in three steps.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">No booking, no travel, no awkward posing. Just a few photos you already have.</p>
          <a class="btn btn-ink" style="margin-top:32px" href="${cta}" data-link data-reveal>Start your shoot ${icon("arrow-right")}</a>
        </div>
        <ol class="step-list">
          <li class="step-item" data-reveal>
            <span class="step-no">01</span>
            <div>
              <h3 class="display h-3">Upload a few selfies</h3>
              <p>Drop in 1–6 everyday photos. Before anything renders, our AI photo check scores each one for lighting, sharpness, visibility and expression — and tells you exactly what to fix.</p>
              <div class="step-meta"><span class="chip">${icon("scan-face")} AI photo check</span><span class="chip">${icon("lock")} Private by default</span></div>
            </div>
          </li>
          <li class="step-item" data-reveal>
            <span class="step-no">02</span>
            <div>
              <h3 class="display h-3">Choose your looks</h3>
              <p>Pair studio backdrops with wardrobe — from seamless studio grey and a navy suit to golden-hour rooftops and a camel knit. Mix up to four looks per shoot.</p>
              <div class="step-meta"><span class="chip">${icon("layers")} ${BACKDROPS.length} backdrops</span><span class="chip">${icon("briefcase")} ${OUTFITS.length} outfits</span></div>
            </div>
          </li>
          <li class="step-item" data-reveal>
            <span class="step-no">03</span>
            <div>
              <h3 class="display h-3">Get graded proofs</h3>
              <p>Watch every frame develop live. Then our AI retoucher grades each headshot for likeness, polish and lighting, circles your best shot, and tells you where each one works best.</p>
              <div class="step-meta"><span class="chip">${icon("badge-check")} Best-pick verdict</span><span class="chip">${icon("download")} Full-res downloads</span></div>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- Styles strip -->
    <section class="section" id="styles" style="padding-top:0">
      <div class="container section-head">
        <div>
          <p class="eyebrow" data-reveal>The wardrobe room</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Every look you'd book a studio for.</h2>
        </div>
        <p class="lede" data-reveal style="--i:2">Corporate, creative or somewhere in between. Each backdrop is lit like a real set, and each outfit is tailored to fit.</p>
      </div>
      <div class="strip" tabindex="0" aria-label="Example looks, scroll horizontally">
        ${STRIP.map((s, i) => {
          const b = BACKDROPS.find((x) => x.id === s.backdrop);
          const o = OUTFITS.find((x) => x.id === s.outfit);
          return html`<figure class="strip-card print" data-reveal style="--i:${i % 5};margin:0">
            <img src="${example(`strip-${i + 1}`)}" alt="Example headshot: ${b.name} backdrop, ${o.name}" loading="lazy" />
            <figcaption class="print-cap"><b>${b.name}</b><span>${o.name}</span></figcaption>
          </figure>`;
        })}
      </div>
      <p class="container small muted examples-note">${icon("info")} Every example on this page was made by the Keeper Headshots AI studio. The people shown are AI-generated models, not customers.</p>
    </section>

    <!-- Comparison -->
    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>The math</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">A studio's quality. <em>Not</em> a studio's invoice.</h2>
          </div>
          <p class="lede" data-reveal style="--i:2">A traditional headshot session costs a few hundred dollars and half a day. Ours costs less than lunch for two.</p>
        </div>
        <div class="compare" data-reveal>
          <dl class="compare-col">
            <h3 class="h-4">Traditional photographer</h3>
            ${[["Average cost", "$200 – $400"], ["Time to book & shoot", "1 – 3 weeks"], ["Backdrops & outfits", "1 – 2 looks"], ["Number of photos", "3 – 10 edited"], ["Help choosing", "You decide alone"]].map(
              ([k, v]) => html`<div class="compare-row"><dt>${k}</dt><dd>${v}</dd></div>`,
            )}
          </dl>
          <dl class="compare-col">
            <h3 class="h-4">Keeper Headshots</h3>
            ${[["Cost", "From $29"], ["Turnaround", "Under 1 hour"], ["Backdrops & outfits", "Up to 4 looks per shoot"], ["Number of photos", "Up to 8 per shoot"], ["Help choosing", "Every frame graded"]].map(
              ([k, v]) => html`<div class="compare-row"><dt>${k}</dt><dd class="hi">${v}</dd></div>`,
            )}
          </dl>
        </div>
      </div>
    </section>

    <!-- Retoucher showcase -->
    <section class="section inverse">
      <div class="container showcase">
        <div>
          <p class="eyebrow" data-reveal>Your AI retoucher</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Know which headshot to use — <em>instantly.</em></h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">A set of headshots is only useful if you can tell the great ones apart. Every shoot is graded before it reaches you.</p>
          <ul class="feature-list">
            <li data-reveal style="--i:1"><span class="ficon">${icon("user-round")}</span><div><b>Likeness first</b><span>Every frame is compared against your originals. If it doesn't look like you, it's flagged.</span></div></li>
            <li data-reveal style="--i:2"><span class="ficon">${icon("focus")}</span><div><b>Artifact detection</b><span>Warped ears, melted collars, plastic skin — caught before you post them.</span></div></li>
            <li data-reveal style="--i:3"><span class="ficon">${icon("briefcase")}</span><div><b>Where each shot works</b><span>LinkedIn, speaker bio, company site — matched to the right photo.</span></div></li>
          </ul>
        </div>
        <div data-reveal style="--i:2">
          ${reviewPreview()}
        </div>
      </div>
    </section>

    <!-- Reviews -->
    <section class="section" id="reviews">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Reviews</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Loved by people who hate being photographed.</h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Founders, recruiters, nurses, lawyers, whole sales teams. Here's what they say.</p>
        </div>
        <div class="quotes">
          <figure class="quote quote-lg" data-reveal style="margin:0">
            <span class="stars" role="img" aria-label="5 out of 5 stars">${[1, 2, 3, 4, 5].map(() => icon("star"))}</span>
            <blockquote>“I'd put off new headshots for three years. Uploaded four selfies on my lunch break and had my new LinkedIn photo before my next meeting.”</blockquote>
            <figcaption class="quote-by"><span class="initials" aria-hidden="true">DR</span><div><b>Daniel R.</b><span>Product lead, fintech</span></div></figcaption>
          </figure>
          <div class="quote-stack">
            <figure class="quote quote-sm" data-reveal style="--i:1;margin:0">
              <span class="stars" role="img" aria-label="5 out of 5 stars">${[1, 2, 3, 4, 5].map(() => icon("star"))}</span>
              <blockquote>“The photo check told me my selfies were too dark. Retook two by a window and the results were uncanny — in a good way.”</blockquote>
              <figcaption class="quote-by"><span class="initials" aria-hidden="true">PS</span><div><b>Priya S.</b><span>Clinical nurse educator</span></div></figcaption>
            </figure>
            <figure class="quote quote-sm" data-reveal style="--i:2;margin:0">
              <span class="stars" role="img" aria-label="5 out of 5 stars">${[1, 2, 3, 4, 5].map(() => icon("star"))}</span>
              <blockquote>“We did our whole 12-person team. Matching backdrops, zero scheduling. Our about page finally looks like one company.”</blockquote>
              <figcaption class="quote-by"><span class="initials" aria-hidden="true">MT</span><div><b>Marcus T.</b><span>Head of People, SaaS</span></div></figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>

    <!-- Pricing -->
    <section class="section" id="pricing" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Pricing</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">One payment. <em>No</em> subscription.</h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Pick a package, keep every photo forever. Covered by our 100% money-back guarantee.</p>
        </div>
        <div class="pricing">
          ${PACKAGES.map(
            (p, i) => html`<article class="plan ${p.popular ? "plan-pop" : ""}" data-reveal style="--i:${i}">
              ${p.popular ? html`<span class="plan-badge">Most popular</span>` : ""}
              <div>
                <h3 class="h-4">${p.name}</h3>
                <p class="muted small">${p.shoots} shoots · up to ${p.shoots * 8} headshots</p>
              </div>
              <div class="plan-price"><span class="amt">$${p.price}</span><span class="muted small">one-time</span></div>
              <ul class="plan-feats">${p.features.map((f) => html`<li>${icon("check")}${f}</li>`)}</ul>
              <a class="btn ${p.popular ? "btn-flash" : "btn-ghost"} btn-block" href="/app/buy/${p.id}" data-link>Choose ${p.name} ${icon("arrow-right")}</a>
            </article>`,
          )}
        </div>
        <p class="guarantee">${icon("shield-check")} 100% money-back guarantee — if none of your headshots are usable, you pay nothing.</p>
        <div class="teams" id="teams" data-reveal>
          <div style="display:flex;gap:16px;align-items:center">
            <span class="t-ic">${icon("users")}</span>
            <div><b class="h-4" style="display:block">Headshots for your whole team</b><span class="muted small">One shoot per person, with the same backdrops and wardrobe for everyone. Executive covers 12 people. Larger team? Contact us about volume pricing.</span></div>
          </div>
          <a class="btn btn-ink" href="/contact?topic=team" data-link>Contact us ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="section" id="faq" style="padding-top:0">
      <div class="container faq">
        <div>
          <p class="eyebrow" data-reveal>FAQ</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Questions, answered.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">Still unsure? <a class="link" href="/contact" data-link>Contact us</a> or email <a class="link" href="mailto:hello@keeperheadshots.com">hello@keeperheadshots.com</a>.</p>
        </div>
        <div class="faq-list">
          ${FAQ.map(([q, a], i) => html`<details data-reveal style="--i:${i % 3}" ${i === 0 ? raw("open") : ""}><summary>${q}${icon("chevron-down")}</summary><p>${a}</p></details>`)}
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="section-tight">
      <div class="container">
        <div class="cta-band" data-reveal>
          <div>
            <p class="eyebrow" style="color:#a9b1bd">Ready when you are</p>
            <h2 class="display h-1" style="margin-top:16px">Your next headshot is already in your camera roll.</h2>
          </div>
          <a class="btn btn-flash btn-lg" href="${cta}" data-link>Create your headshots ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>
  </main>
  ${footer()}`.v;
}

function reviewPreview() {
  const shots = [
    { seed: "rv-1", backdrop: "studio-gray", outfit: "navy-suit", score: 94, g: "keeper" },
    { seed: "rv-2", backdrop: "glass-office", outfit: "charcoal-blazer", score: 86, g: "keeper" },
    { seed: "rv-3", backdrop: "city-terrace", outfit: "camel-knit", score: 79, g: "solid" },
    { seed: "rv-4", backdrop: "library", outfit: "black-turtleneck", score: 58, g: "retake" },
  ];
  return html`<div class="panel" style="background:var(--paper-100);color:var(--ink-950);padding:20px;border-radius:24px;box-shadow:var(--shadow-3)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">
      <span class="eyebrow"><span class="dot"></span>Retoucher's verdict</span>
      <span class="badge badge-success">${icon("check")} 3 keepers</span>
    </div>
    <div style="display:grid;grid-template-columns:1.1fr 1fr;gap:16px;align-items:start">
      <div class="print" style="position:relative;padding:8px 8px 0">
        <img src="${example(shots[0].seed)}" alt="Example best-pick headshot" loading="lazy" />
        <div class="print-cap"><b>Best pick</b><span>94 / 100</span></div>
      </div>
      <div style="display:grid;gap:14px">
        <p class="display" style="font-size:1.6rem;line-height:1.1">“Studio gray leads — crisp, confident, unmistakably you.”</p>
        <div class="bars">
          ${[["Likeness", 9], ["Polish", 9], ["Lighting", 10]].map(([k, v]) => html`<div class="bar-row"><span class="small">${k}</span><div class="meter-track"><div class="meter-fill" style="--v:${v};--mcol:var(--teal-600)"></div></div><b class="small">${v}</b></div>`)}
        </div>
        <span class="chip" style="justify-self:start">${icon("briefcase")} Best for LinkedIn</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px">
      ${shots.slice(1).map(
        (s) => html`<div style="position:relative"><img src="${example(s.seed)}" alt="" loading="lazy" style="aspect-ratio:4/5;object-fit:cover;border-radius:4px;width:100%" />
        <span class="score-pill g-${s.g}" style="position:absolute;left:6px;bottom:6px;height:24px;font-size:11px"><i></i>${s.score}</span></div>`,
      )}
    </div>
  </div>`;
}

export function footer() {
  return html`<footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <a class="logo" href="/" data-link style="color:var(--text)">${logoMark()}${wordmark()}</a>
          <p style="margin-top:12px;max-width:34ch">Professional headshots from the photos you already have. Checked, developed and graded by AI.</p>
        </div>
        <div><h4>Product</h4><ul><li><a href="/#how">How it works</a></li><li><a href="/#styles">Styles</a></li><li><a href="/#pricing">Pricing</a></li><li><a href="/#teams">Teams</a></li></ul></div>
        <div><h4>Account</h4><ul><li><a href="/signin" data-link>Sign in</a></li><li><a href="/signup" data-link>Create account</a></li><li><a href="/app" data-link>Your shoots</a></li></ul></div>
        <div><h4>Company</h4><ul><li><a href="/#reviews">Reviews</a></li><li><a href="/contact" data-link>Contact us</a></li><li><a href="/#pricing">Money-back guarantee</a></li></ul></div>
      </div>
      <div class="footer-base"><span>© ${new Date().getFullYear()} Keeper Headshots</span><span>Your photos are never used to train AI models.</span></div>
    </div>
  </footer>`;
}
