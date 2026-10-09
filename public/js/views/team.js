import { html, icon, raw, state, example } from "../core.js";
import { PACKAGES } from "../shared/catalog.js";
import { TEAM_FAQ } from "../shared/faq.js";
import { footer } from "./landing.js";

// /team-headshots: search landing page for "team headshots" / company
// headshots. Its FAQ also feeds the page's structured data (lib/seo.js).

// Example team (lib/examples.js TEAM): six people, one backdrop. Roles are
// placeholders for the mock team page, not real people.
const TEAM = [
  ["team-1", "Operations"],
  ["team-2", "Sales"],
  ["team-3", "Engineering"],
  ["team-4", "Finance"],
  ["team-5", "Marketing"],
  ["team-6", "Support"],
];

const perPerson = (p) => `$${(p.price / p.shoots).toFixed(2)}`;

function teamPage() {
  return html`<div class="tm-page" role="img" aria-label="Example team page: six people photographed in the same Glass Office backdrop">
    <div class="tm-page-bar"><span></span><span></span><span></span><b>yourcompany.com/team</b></div>
    <p class="tm-page-title">Our team</p>
    <div class="tm-grid">
      ${TEAM.map(
        ([id, role]) => html`<div class="tm-person">
          <img src="${example(id)}" alt="" loading="eager" />
          <span class="tm-bar"></span>
          <span class="tm-role">${role}</span>
        </div>`,
      )}
    </div>
  </div>`;
}

export function renderTeam({ root }) {
  const cta = state.user ? "/app/team" : `/signup?next=${encodeURIComponent("/app/team")}`;
  const exec = PACKAGES.find((p) => p.id === "executive") || PACKAGES[PACKAGES.length - 1];
  root.innerHTML = html`
  <main id="main">
    <section class="hero tm-hero">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow" data-reveal style="--i:0"><span class="dot"></span>Team headshots</p>
          <h1 class="display h-hero" data-reveal style="--i:1">Team headshots that <em>finally match.</em></h1>
          <p class="lede" data-reveal style="--i:2">Give everyone on your team a professional headshot in the same backdrop and lighting, from a few selfies each. No photographer to book and no one left out for working remotely. Every headshot arrives ready to use, for your website, LinkedIn and Microsoft Teams.</p>
          <div class="hero-ctas" data-reveal style="--i:3">
            <a class="btn btn-flash btn-lg" href="${cta}" data-link>Start your team's headshots ${icon("arrow-right")}</a>
            <a class="btn btn-ghost btn-lg" href="/contact?topic=team" data-link>Ask about volume pricing</a>
          </div>
          <div class="hero-proof" data-reveal style="--i:4">
            <div class="proof-item"><strong class="tabular">~$4</strong><span>per person with ${exec.name}</span></div>
            <div class="proof-item"><strong class="tabular">Same</strong><span>looks for the whole team</span></div>
            <div class="proof-item"><strong class="tabular">0</strong><span>photo days to schedule</span></div>
          </div>
        </div>
        <div class="hero-visual" data-reveal style="--i:2">${teamPage()}</div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Why teams use Keeper</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">One style. <em>Everyone</em> in it.</h2>
          </div>
          <p class="lede" data-reveal style="--i:2">A photographer's visit means one day, one office and whoever happens to be in. Keeper works from the photos people already have, wherever they are.</p>
        </div>
        <div class="li-cards tm-cards">
          ${[
            ["layers", "A consistent look", "Pick one backdrop for everyone. Each person gets the same setting and lighting, so your team page, org chart and email signatures look like they belong together."],
            ["users", "Remote and hybrid friendly", "Everyone sends a few selfies from wherever they work. No scheduling, no travel, no one missing from the team page."],
            ["plus", "New hires match later", "Unused shoots don't expire while your account is open. When someone joins, invite them from your team page and they fit right in."],
            ["focus", "Ready for every profile", "Each headshot comes as a full-resolution portrait for your website and a 1:1 square framed for LinkedIn, Microsoft Teams and Slack."],
            ["badge-check", "Checked before anyone sees it", "Every headshot is compared with that person's own photos for likeness and inspected for polish. Anything that falls short is retaken automatically."],
            ["lock", "Private by default", "Photos stay private to your account, are never used to train AI, and any shoot can be deleted at any time."],
          ].map(
            ([ic, t, d], i) => html`<article class="li-card" data-reveal style="--i:${i % 3}">
              <span class="li-ic">${icon(ic)}</span>
              <h3 class="h-4">${t}</h3>
              <p>${d}</p>
            </article>`,
          )}
        </div>
      </div>
    </section>

    <section class="section inverse">
      <div class="container li-guide">
        <div>
          <p class="eyebrow" data-reveal>How it works for teams</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Your whole team in <em>four steps.</em></h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">One person sets it up and pays; everyone else just gets an email. Each person's shoot has up to 4 looks and 8 headshots.</p>
        </div>
        <ol class="li-tips tm-steps">
          ${[
            ["Choose your team's look", "Name your team and pick its looks, like Glass Office in suits and blazers. Everyone's shoot uses them, so the headshots match."],
            ["Invite your team by email", "Paste in your colleagues' addresses. Each invite uses one shoot from your package; a cancelled invite, or one not accepted within 90 days, gives it back."],
            ["Everyone adds their own selfies", "Each person opens their invite, signs in with that address and uploads a few photos of themselves. Their photos stay private to them."],
            ["Download everyone's headshots", "Watch each person's progress on your team page, then download their finished headshots in one go for your website, LinkedIn, Teams and Slack."],
          ].map(([t, d], i) => html`<li data-reveal style="--i:${i % 3}"><span class="li-no">${String(i + 1).padStart(2, "0")}</span><div><b>${t}</b><span>${d}</span></div></li>`)}
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <p class="eyebrow" data-reveal>Team pricing</p>
            <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">One shoot per person. <em>No</em> subscription.</h2>
          </div>
          <p class="lede" data-reveal style="--i:2">Buy a package, use one shoot for each person, and keep any leftovers for new hires. Your first package is covered by our <a class="link" href="/refunds" data-link>money-back guarantee</a>.</p>
        </div>
        <div class="tm-prices">
          ${PACKAGES.map(
            (p, i) => html`<div class="tm-price ${p.id === exec.id ? "tm-price-pop" : ""}" data-reveal style="--i:${i}">
              <p class="tm-price-name">${p.name}</p>
              <p class="tm-price-team"><b>${p.shoots}</b> people</p>
              <p class="tm-price-amt"><span>$${p.price}</span> one-time</p>
              <p class="tm-price-each">${perPerson(p)} per person</p>
            </div>`,
          )}
          <div class="tm-price tm-price-more" data-reveal style="--i:3">
            <p class="tm-price-name">Larger team</p>
            <p class="tm-price-team"><b>13+</b> people</p>
            <p class="tm-price-each">Combine packages, or talk to us about volume pricing.</p>
            <a class="btn btn-ink btn-sm" href="/contact?topic=team" data-link>Contact us ${icon("arrow-right")}</a>
          </div>
        </div>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="container faq">
        <div>
          <p class="eyebrow" data-reveal>Team headshot FAQ</p>
          <h2 class="display h-1" data-reveal style="--i:1;margin-top:16px">Questions, answered.</h2>
          <p class="lede" data-reveal style="--i:2;margin-top:20px">More in our <a class="link" href="/#faq">main FAQ</a>, or <a class="link" href="/contact?topic=team" data-link>contact us</a> about your team.</p>
        </div>
        <div class="faq-list">
          ${TEAM_FAQ.map(([q, a], i) => html`<details data-reveal style="--i:${i % 3}" ${i === 0 ? raw("open") : ""}><summary>${q}${icon("chevron-down")}</summary><p>${a}</p></details>`)}
        </div>
      </div>
    </section>

    <section class="section-tight">
      <div class="container">
        <div class="cta-band">
          <div>
            <p class="eyebrow" style="color:#a9b1bd">About $4 a person · no photographer needed</p>
            <h2 class="display h-1" style="margin-top:16px">Your team page, finally matching.</h2>
          </div>
          <a class="btn btn-flash btn-lg" href="${cta}" data-link>Start your team's headshots ${icon("arrow-right")}</a>
        </div>
      </div>
    </section>
  </main>
  ${footer()}`.v;
}
