import { $, $$, html, icon, raw, greaseCircle, state, logoMark, wordmark, example } from "../core.js";
import { BACKDROPS, OUTFITS, PACKAGES } from "../shared/catalog.js";
import { FAQ } from "../shared/faq.js";

// People the hero rotates through: a selfie plus nine headshots each.
const HERO_SETS = [
  ["hero", 96], ["p1", 95], ["p2", 94], ["p3", 97], ["p4", 95], ["p5", 96], ["p6", 94], ["p7", 95], ["p8", 97],
];
const CYCLE_MS = 8000;

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



export function renderLanding({ root }) {
  const cta = state.user ? "/app/new" : "/signup";
  root.innerHTML = html`
  <main id="main">
    <!-- Hero -->
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>The AI headshot studio</p>
          <h1 class="display h-hero" data-reveal style="--i:1">Professional AI headshots, <em>without</em> the photo shoot.</h1>
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

        <div class="hero-visual">
        <div class="sheet" id="heroSheet" data-reveal style="--i:2">
          <div class="sheet-board" role="img" aria-label="Example: one casual selfie becomes a contact sheet of nine professional headshots of the same person">
            ${HERO_FRAMES.map(
              ([b, o], i) => html`<div class="sheet-frame ${i === 4 ? "keeper" : ""}" style="--d:${i}">
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
          <span class="tag-keeper">${icon("badge-check")} Best pick <span class="score" id="heroScore">96</span></span>
        </div>
        <div class="sheet-controls" role="group" aria-label="Example people">
          <div class="sheet-dots">${HERO_SETS.map((_, i) => html`<button type="button" class="sheet-dot" data-set="${i}" aria-label="Show example ${i + 1} of ${HERO_SETS.length}" aria-pressed="${i === 0 ? "true" : "false"}"></button>`)}</div>
          <button type="button" class="sheet-pause" id="heroPause" aria-label="Pause examples">${icon("pause")}</button>
        </div>
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
              <p>Watch every frame develop live. Each one is checked for likeness and polish before you see it, and anything that falls short is retaken automatically. Then our AI retoucher grades the set, circles your best shot, and tells you where each one works best.</p>
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
        <p class="guarantee">${icon("shield-check")} 100% money-back guarantee: if none of your headshots are usable, we'll refund you in full. <a class="link" href="/refunds" data-link>See the terms</a></p>
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
  return heroCycle();
}

// Rotate the hero through example people. The next set is decoded before the
// swap so frames never flash empty. Pauses on hover/focus, when the tab is
// hidden, or via the button; no autoplay for reduced-motion users.
function heroCycle() {
  const sheet = $("#heroSheet");
  if (!sheet) return null;
  const imgs = $$(".sheet-frame img", sheet);
  const selfie = $(".polaroid img", sheet);
  const dots = $$(".sheet-dot");
  const pauseBtn = $("#heroPause");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current = 0;
  let paused = reduce;
  let hovering = false;
  let busy = false;
  let timer = null;
  const urls = (i) => [example(`${HERO_SETS[i][0]}-selfie`), ...Array.from({ length: 9 }, (_, j) => example(`${HERO_SETS[i][0]}-${j + 1}`))];
  const preload = (i) =>
    Promise.all(urls(i).map((u) => { const im = new Image(); im.src = u; return im.decode(); }));

  const setPauseUI = () => {
    pauseBtn.setAttribute("aria-label", paused ? "Play examples" : "Pause examples");
    pauseBtn.innerHTML = icon(paused ? "play" : "pause").v;
  };
  async function show(i) {
    if (busy || i === current) return;
    busy = true;
    try {
      await preload(i);
    } catch {
      busy = false;
      return; // a missing image: stay on the current person
    }
    sheet.classList.add("swapping");
    await new Promise((r) => setTimeout(r, reduce ? 0 : 520));
    const [sel, ...frames] = urls(i);
    selfie.src = sel;
    imgs.forEach((im, j) => (im.src = frames[j]));
    $("#heroScore").textContent = HERO_SETS[i][1];
    const circle = $(".sheet-circle", sheet);
    if (circle && !reduce) circle.replaceWith(circle.cloneNode(true)); // replays the pencil loop
    sheet.classList.remove("swapping");
    dots.forEach((d, j) => d.setAttribute("aria-pressed", String(j === i)));
    current = i;
    busy = false;
  }
  const tick = () => {
    if (!paused && !hovering && !document.hidden) show((current + 1) % HERO_SETS.length);
  };
  const start = () => {
    clearInterval(timer);
    timer = setInterval(tick, CYCLE_MS);
  };

  dots.forEach((d) => d.addEventListener("click", () => { show(Number(d.dataset.set)); start(); }));
  pauseBtn.addEventListener("click", () => { paused = !paused; setPauseUI(); });
  sheet.addEventListener("mouseenter", () => (hovering = true));
  sheet.addEventListener("mouseleave", () => (hovering = false));
  // Keyboard focus inside the sheet pauses too (mouse clicks don't count).
  sheet.addEventListener("focusin", (e) => { if (e.target.matches(":focus-visible")) hovering = true; });
  sheet.addEventListener("focusout", () => (hovering = false));
  setPauseUI();
  start();
  // Warm the next person's photos once the page has settled.
  setTimeout(() => preload(1).catch(() => {}), 2500);
  return () => clearInterval(timer);
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
        <div><h4>Company</h4><ul><li><a href="/#faq">FAQ</a></li><li><a href="/contact" data-link>Contact us</a></li><li><a href="/refunds" data-link>Money-back guarantee</a></li><li><a href="/privacy" data-link>Privacy policy</a></li><li><a href="/terms" data-link>Terms of service</a></li></ul></div>
      </div>
      <div class="footer-base"><span>© ${new Date().getFullYear()} Keeper Headshots</span><span>Your photos are never used to train AI models.</span></div>
    </div>
  </footer>`;
}
