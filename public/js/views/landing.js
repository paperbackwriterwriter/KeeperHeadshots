import { $, $$, html, icon, raw, greaseCircle, state, logoMark, wordmark, example } from "../core.js";
import { customersInner } from "../shared/customers.js";
import { BACKDROPS, OUTFITS, PACKAGES, PREVIEW_OFFERS } from "../shared/catalog.js";
import { FAQ } from "../shared/faq.js";

// People the hero rotates through: a selfie plus nine headshots each, the
// best pick's score, and which frame (0-8) is circled as the best pick. Frames
// 6 and 7 sit under the selfie polaroid and 2 under the "Best pick" tag, so
// the pick moves around the others.
const HERO_SETS = [
  ["hero", 96, 1], ["p1", 95, 5], ["p2", 94, 0], ["p3", 97, 8], ["p4", 95, 3], ["p5", 96, 4], ["p6", 94, 1], ["p7", 95, 5], ["p8", 97, 0],
];
const CYCLE_MS = 8000;
const frameSources = (id) => [180, 360, 600].map((w) => `${example(id, w)} ${w}w`).join(", ");
// The phone hero's selfie and headshot (up to 190px wide): 300px covers
// high-density screens without downloading the 360px or larger variants.
const pairSources = (id) => [180, 300, 360].map((w) => `${example(id, w)} ${w}w`).join(", ");
// Their displayed width: two columns either side of the arrow (26px, two 10px
// gaps) in the text column (the page less its 16px gutters, at most 420px).
const PAIR_SIZES = "calc((min(100vw - 32px, 420px) - 46px) / 2)";
// The pair shows on phones only (app.css .hero-ba): wider screens get a blank
// source, so the hidden images aren't downloaded.
const PHONE_ONLY = `<source media="(min-width: 901px)" srcset="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" />`;
// The contact sheet's "before" selfie: 38% of the sheet, less its border.
const POLAROID_SIZES = "(max-width: 900px) min(calc(38vw - 12px), 190px), 205px";

const HERO_FRAMES = [
  ["studio-gray", "navy-suit"], ["glass-office", "charcoal-blazer"], ["city-terrace", "camel-knit"],
  ["library", "black-turtleneck"], ["studio-gray", "charcoal-blazer"], ["botanical", "oxford"],
  ["studio-white", "white-shirt"], ["glass-office", "navy-suit"], ["city-terrace", "oxford"],
];

// The wardrobe strip: example headshots (lib/examples.js), including the
// looks from the lawyer and doctor pages. Ordered so no two neighbours share a
// backdrop, including across the loop from the last card back to the first.
const STRIP = [
  { id: "strip-1", backdrop: "studio-gray", outfit: "navy-suit" },
  { id: "md-1", backdrop: "glass-office", outfit: "white-coat" },
  { id: "strip-3", backdrop: "city-terrace", outfit: "camel-knit" },
  { id: "lw-1", backdrop: "library", outfit: "suit-tie" },
  { id: "strip-5", backdrop: "studio-white", outfit: "white-shirt" },
  { id: "strip-7", backdrop: "studio-gray", outfit: "charcoal-blazer" },
  { id: "md-3", backdrop: "glass-office", outfit: "scrubs" },
  { id: "strip-6", backdrop: "botanical", outfit: "oxford" },
  { id: "strip-4", backdrop: "library", outfit: "black-turtleneck" },
  { id: "lw-4", backdrop: "studio-white", outfit: "charcoal-blazer" },
  { id: "strip-2", backdrop: "glass-office", outfit: "charcoal-blazer" },
];



export function renderLanding({ root, hydrate = false }) {
  const cta = state.user ? "/app/new" : "/signup";
  if (!hydrate) root.innerHTML = html`
  <main id="main">
    <!-- Hero -->
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>The AI headshot studio</p>
          <h1 class="display h-hero" data-reveal style="--i:1">Professional AI headshots, <em>without</em> the photo shoot.</h1>
          <div class="hero-ba" role="img" aria-label="Example: a casual selfie, and a professional headshot made from it" data-reveal style="--i:2">
            <figure><picture>${raw(PHONE_ONLY)}<img src="${example("hero-selfie", 360)}" srcset="${pairSources("hero-selfie")}" sizes="${PAIR_SIZES}" alt="" width="360" height="480" fetchpriority="high" /></picture><figcaption>Your selfie</figcaption></figure>
            <span class="hero-ba-arrow" aria-hidden="true">${icon("arrow-right")}</span>
            <figure><picture>${raw(PHONE_ONLY)}<img src="${example("hero-2", 360)}" srcset="${pairSources("hero-2")}" sizes="${PAIR_SIZES}" alt="" width="360" height="480" fetchpriority="high" /></picture><figcaption>Your headshot</figcaption></figure>
          </div>
          <p class="lede" data-reveal style="--i:2">Upload a few selfies. Our AI studio checks your photos, develops studio-quality headshots in the looks you choose, then grades every frame so you know exactly which one to use.</p>
          <div class="hero-ctas" data-reveal style="--i:3">
            <a class="btn btn-flash btn-lg" href="${cta}" data-link>${state.user ? "Create your headshots" : "Try it free"} ${icon("arrow-right")}</a>
            <a class="btn btn-ghost btn-lg" href="/#how">See how it works</a>
          </div>
          <div class="hero-proof" data-reveal style="--i:4">
            <div class="proof-item"><strong class="tabular">&lt; 15 min</strong><span>typical turnaround</span></div>
            <div class="proof-item"><strong>Free</strong><span>preview, keep yours from $${PREVIEW_OFFERS[0].price}</span></div>
            <div class="proof-item"><strong class="tabular">Money-back</strong><span>guarantee on your first package</span></div>
          </div>
        </div>

        <div class="hero-visual">
        <div class="sheet" id="heroSheet" data-reveal style="--i:2">
          <div class="sheet-board" role="img" aria-label="Example: one casual selfie becomes a contact sheet of professional headshots of the same person">
            ${HERO_FRAMES.map(
              ([b, o], i) => html`<div class="sheet-frame ${i === HERO_SETS[0][2] ? "keeper" : ""}" style="--d:${i}">
                <img src="${example(`hero-${i + 1}`, 360)}" srcset="${frameSources(`hero-${i + 1}`)}" sizes="(max-width: 600px) 23vw, 145px" alt="" loading="${i < 6 ? "eager" : "lazy"}" />
                <span class="fno">${String(i + 1).padStart(2, "0")}A</span>
                ${i === HERO_SETS[0][2] ? greaseCircle() : ""}
              </div>`,
            )}
          </div>
          <figure class="polaroid">
            <img src="${example("hero-selfie", 360)}" srcset="${pairSources("hero-selfie")}" sizes="${POLAROID_SIZES}" alt="" loading="lazy" decoding="async" />
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
            ["< 15 min", "Typical turnaround"],
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
              <p>Pair studio backdrops with wardrobe — from seamless studio gray and a navy suit to golden-hour rooftops and a camel knit. Mix up to four looks per shoot.</p>
              <div class="step-meta"><span class="chip">${icon("layers")} ${BACKDROPS.length} backdrops</span><span class="chip">${icon("briefcase")} ${OUTFITS.length} outfits</span></div>
            </div>
          </li>
          <li class="step-item" data-reveal>
            <span class="step-no">03</span>
            <div>
              <h3 class="display h-3">Get graded proofs</h3>
              <p>Watch every frame develop live. Each one is checked for likeness and polish before you see it, and anything that falls short is retaken automatically. Then our AI retoucher grades the set, circles your best shot, and tells you where each one works best.</p>
              <div class="step-meta"><span class="chip">${icon("badge-check")} Best-pick verdict</span><span class="chip">${icon("download")} Full-res downloads</span><span class="chip">${icon("focus")} LinkedIn &amp; Teams squares</span></div>
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
      <div class="marquee" data-reveal style="--i:3" role="region" aria-label="Example looks" tabindex="0">
        <div class="marquee-track">
          <ul class="marquee-group">
            ${STRIP.map((s) => {
              const b = BACKDROPS.find((x) => x.id === s.backdrop);
              const o = OUTFITS.find((x) => x.id === s.outfit);
              return html`<li><figure class="strip-card print">
                <img src="${example(s.id)}" srcset="${frameSources(s.id)}" sizes="(max-width: 640px) 184px, 224px" alt="Example headshot: ${b.name} backdrop, ${o.name}" loading="lazy" decoding="async" width="224" height="280" />
                <figcaption class="print-cap"><b>${b.name}</b><span>${o.name}</span></figcaption>
              </figure></li>`;
            })}
          </ul>
        </div>
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
          <div class="compare-col">
            <h3 class="h-4">Traditional photographer</h3>
            <dl class="compare-list">
            ${[["Average cost", "$200 – $400"], ["Time to book & shoot", "1 – 3 weeks"], ["Backdrops & outfits", "1 – 2 looks"], ["Number of photos", "3 – 10 edited"], ["Help choosing", "You decide alone"]].map(
              ([k, v]) => html`<div class="compare-row"><dt>${k}</dt><dd>${v}</dd></div>`,
            )}
            </dl>
          </div>
          <div class="compare-col">
            <h3 class="h-4">Keeper Headshots</h3>
            <dl class="compare-list">
            ${[["Cost", "From $8.99"], ["Turnaround", "Under 15 minutes"], ["Backdrops & outfits", "Up to 4 looks per shoot"], ["Number of photos", "Up to 8 per shoot"], ["Help choosing", "Every frame graded"]].map(
              ([k, v]) => html`<div class="compare-row"><dt>${k}</dt><dd class="hi">${v}</dd></div>`,
            )}
            </dl>
          </div>
        </div>
      </div>
    </section>

    <!-- Retoucher showcase -->
    <section class="section inverse showcase-wrap">
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
          <p class="lede" data-reveal style="--i:2">Start with a free preview and keep only what you like, or pick a package. Your first package is covered by our <a class="link" href="/refunds" data-link><span class="nowrap">money-back</span> guarantee</a>.</p>
        </div>
        <div class="start-free-wrap"><div class="start-free" data-reveal>
          <div class="sf-step"><span class="sf-amt">$0</span><div><b>Free preview</b><span>2 looks, 4 headshots. No card needed.</span></div></div>
          ${PREVIEW_OFFERS.map((o) => html`<div class="sf-step ${o.popular ? "sf-pop" : ""}"><span class="sf-amt">$${o.price}</span><div><b>${o.name}</b><span>${o.looks ? `Every headshot from your preview, plus ${o.looks} new looks.` : "The one headshot you like best, full resolution."}</span></div></div>`)}
          <a class="btn btn-flash" href="${cta}" data-link>Try it free ${icon("arrow-right")}</a>
        </div></div>
        <p class="pricing-or">Need more shoots? Packages include every look and headshot:</p>
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
        <p class="guarantee">${icon("shield-check")}<span>Money-back guarantee: if none of the headshots from your first paid shoot are usable, tell us within 30 days of purchase and we'll refund the package, less any later shoots you kept. <a class="link" href="/refunds" data-link>See the terms</a></span></p>
        <div class="teams" id="teams" data-reveal>
          <div style="display:flex;gap:16px;align-items:flex-start">
            <span class="t-ic">${icon("users")}</span>
            <div><b class="h-4" style="display:block">Headshots for your whole team</b><span class="muted small">One shoot per person, with the same backdrops and wardrobe for everyone. Executive covers 12 people. Larger team? Contact us about volume pricing.</span></div>
          </div>
          <a class="btn btn-ink" href="/team-headshots" data-link>Team headshots ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>

    <!-- Customer results: filled in only when customers have shared some (lib/showcase.js) -->
    <section class="section" id="customers" style="padding-top:0" aria-labelledby="customersTitle" hidden></section>

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
  // Keep the server-rendered headline and images on first load. Only the
  // signed-in destinations need updating before attaching page behavior.
  if (hydrate && state.user) root.querySelectorAll('a[href="/signup"][data-link]').forEach((a) => a.setAttribute("href", cta));
  const stopHero = heroCycle();
  const stopStrip = stripPreload();
  const stopReel = stripReel();
  rendered = performance.now();
  customerResults();
  return () => {
    stopHero?.();
    stopStrip?.();
    stopReel?.();
  };
}

// Headshots customers shared with their permission, once approved. The
// section stays hidden until there's at least one.
let rendered = 0;
async function customerResults() {
  let entries = [];
  try {
    entries = (await (await fetch("/api/showcase")).json()).entries || [];
  } catch {
    return;
  }
  const slot = $("#customers");
  if (!slot) return;
  if (!entries.length) {
    slot.hidden = true;
    slot.replaceChildren();
    return;
  }
  const wasHidden = slot.hidden;
  slot.innerHTML = customersInner(entries);
  slot.hidden = false;
  // Opened at a section below this one (/#faq), whose scroll (perhaps still
  // a smooth one) was aimed before the section appeared: go to it again, at
  // once, unless the visitor has had time to scroll somewhere themselves.
  const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (wasHidden && target && performance.now() - rendered < 3000 && slot.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) target.scrollIntoView({ block: "start", behavior: "instant" });
}

// The wardrobe strip's photos are lazy, but most of them sit outside the
// clipped row until the animation slides them in, so browsers (Safari
// especially) would only fetch each one as it arrives, showing empty cards.
// Load them all once the section is near the screen.
function stripPreload() {
  const row = $(".marquee");
  if (!row) return null;
  const load = () => $$("img[loading=lazy]", row).forEach((im) => (im.loading = "eager"));
  if (!("IntersectionObserver" in window)) return void load();
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      load();
    }
  }, { rootMargin: "800px 0px" });
  io.observe(row);
  return () => io.disconnect();
}

// Slides the wardrobe strip left forever. Each card is placed every frame
// at its spot on a loop one strip long; a card that leaves on the left moves
// straight to the back of the line, off the right edge. (Sliding the whole
// row, or each card by a whole strip's width, as CSS animations, left blank
// stretches on iPhone Safari, which skips drawing animated layers that are
// too large or start far off screen.) Runs only while the strip is on
// screen; reduced-motion users get a still row they can scroll instead.
const REEL_SPEED = 38; // px per second
function stripReel() {
  const row = $(".marquee");
  const list = row && $(".marquee-group", row);
  if (!list || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const originals = [...list.children];
  let cards = originals;
  let step = 0; // one card plus the gap
  let loop = 0; // the whole line of cards
  let offset = 0;
  let last = 0;
  let frame = 0;
  let visible = false;
  const measure = () => {
    // A very wide screen needs more cards than one strip to stay covered.
    step = originals[1].offsetLeft - originals[0].offsetLeft;
    while (cards.length * step < row.clientWidth + 2 * step) {
      const copies = originals.map((li) => {
        const c = li.cloneNode(true);
        c.setAttribute("aria-hidden", "true");
        c.querySelector("img")?.setAttribute("alt", "");
        return c;
      });
      list.append(...copies);
      cards = [...list.children];
    }
    loop = cards.length * step;
  };
  const place = () => {
    cards.forEach((li, i) => {
      const x = ((((i * step - offset) % loop) + loop + step) % loop) - step; // from -step up to loop - step
      li.style.transform = `translateX(${(x - i * step).toFixed(1)}px)`;
    });
  };
  const tick = (now) => {
    offset = (offset + (Math.min(now - (last || now), 100) / 1000) * REEL_SPEED) % (loop || 1);
    last = now;
    place();
    frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (frame || !visible) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  row.classList.add("is-reel");
  measure();
  place();
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    visible ? start() : stop();
  });
  io.observe(row);
  const onResize = () => {
    measure();
    place();
  };
  addEventListener("resize", onResize);
  return () => {
    stop();
    io.disconnect();
    removeEventListener("resize", onResize);
  };
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
  let visible = !("IntersectionObserver" in window);
  let warmTimer = null;
  let warmed = false;
  const urls = (i) => [example(`${HERO_SETS[i][0]}-selfie`, [180, 300, 360].find((w) => w >= selfie.clientWidth * devicePixelRatio) || 360), ...imgs.map((im, j) => {
    const width = [180, 360, 600].find((w) => w >= im.clientWidth * devicePixelRatio) || 600;
    return example(`${HERO_SETS[i][0]}-${j + 1}`, width);
  })];
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
    selfie.srcset = pairSources(`${HERO_SETS[i][0]}-selfie`);
    selfie.src = sel;
    imgs.forEach((im, j) => {
      im.srcset = frameSources(`${HERO_SETS[i][0]}-${j + 1}`);
      im.src = frames[j];
    });
    $("#heroScore").textContent = HERO_SETS[i][1];
    // Move the best-pick circle to this person's pick; a fresh copy replays
    // the pencil loop.
    const circle = $(".sheet-circle", sheet);
    if (circle) {
      const frame = imgs[HERO_SETS[i][2]].parentElement;
      $$(".sheet-frame", sheet).forEach((f) => f.classList.toggle("keeper", f === frame));
      frame.append(reduce ? circle : circle.cloneNode(true));
      if (!reduce) circle.remove();
    }
    sheet.classList.remove("swapping");
    dots.forEach((d, j) => d.setAttribute("aria-pressed", String(j === i)));
    current = i;
    busy = false;
  }
  const tick = () => {
    if (visible && !paused && !hovering && !document.hidden) show((current + 1) % HERO_SETS.length);
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
  // On phones the contact sheet starts below the first screen. Don't fetch
  // the next person's ten photos until the rotating sheet is actually visible.
  const warm = () => {
    if (reduce || warmed) return;
    warmed = true;
    warmTimer = setTimeout(() => preload(1).catch(() => {}), 2500);
  };
  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) warm();
  }) : null;
  if (io) io.observe(sheet);
  else warm();
  return () => {
    clearInterval(timer);
    clearTimeout(warmTimer);
    io?.disconnect();
  };
}

function reviewPreview() {
  const shots = [
    { seed: "rv-1", backdrop: "studio-gray", outfit: "navy-suit", score: 94, g: "keeper" },
    { seed: "rv-2", backdrop: "glass-office", outfit: "charcoal-blazer", score: 86, g: "keeper" },
    { seed: "rv-3", backdrop: "city-terrace", outfit: "camel-knit", score: 79, g: "solid" },
    { seed: "rv-4", backdrop: "library", outfit: "black-turtleneck", score: 58, g: "retake" },
  ];
  return html`<div class="panel light-island" style="background:var(--paper-100);color:var(--ink-950);padding:20px;border-radius:24px;box-shadow:var(--shadow-3)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">
      <span class="eyebrow"><span class="dot"></span>Retoucher's verdict</span>
      <span class="badge badge-success">${icon("check")} 2 keepers</span>
    </div>
    <div class="rv-grid">
      <div class="print" style="position:relative;padding:8px 8px 0">
        <img src="${example(shots[0].seed)}" srcset="${frameSources(shots[0].seed)}" sizes="(max-width: 640px) 224px, 280px" alt="Example best-pick headshot" loading="lazy" />
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
        (s) => html`<div style="position:relative"><img src="${example(s.seed)}" srcset="${frameSources(s.seed)}" sizes="(max-width: 640px) 30vw, 140px" alt="" loading="lazy" style="aspect-ratio:4/5;object-fit:cover;border-radius:4px;width:100%" />
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
          <p style="margin-top:12px">Professional headshots from the photos you already have. Checked, developed and graded by AI.</p>
        </div>
        <div><h2 class="footer-h">Product</h2><ul><li><a href="/#how">How it works</a></li><li><a href="/linkedin-headshots" data-link>LinkedIn headshots</a></li><li><a href="/#styles">Looks</a></li><li><a href="/#pricing">Pricing</a></li><li><a href="/team-headshots" data-link>Team headshots</a></li><li><a href="/real-estate-headshots" data-link>Real estate headshots</a></li><li><a href="/resume-headshots" data-link>Résumé headshots</a></li><li><a href="/doctor-headshots" data-link>Doctor headshots</a></li><li><a href="/lawyer-headshots" data-link>Lawyer headshots</a></li></ul></div>
        <div><h2 class="footer-h">Account</h2><ul><li><a href="/signin" data-link>Sign in</a></li><li><a href="/signup" data-link>Create account</a></li><li><a href="/app" data-link>Your shoots</a></li></ul></div>
        <div><h2 class="footer-h">Company</h2><ul><li><a href="/blog">Blog</a></li><li><a href="/#faq">FAQ</a></li><li><a href="/contact" data-link>Contact us</a></li><li><a href="/refunds" data-link>Money-back guarantee</a></li><li><a href="/privacy" data-link>Privacy policy</a></li><li><a href="/terms" data-link>Terms of service</a></li></ul></div>
      </div>
      <div class="footer-base"><span>© ${new Date().getFullYear()} Keeper Headshots</span><span>Your photos are never used to train AI models.</span></div>
    </div>
  </footer>`;
}
