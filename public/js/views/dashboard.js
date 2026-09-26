import { html, icon, api, state, media, relTime, raw } from "../core.js";
import { portraitDataURL } from "../shared/portrait.js";

const STATUS = {
  draft: ["badge", "Photo check pending"],
  checking: ["badge badge-live", "Checking photos"],
  checked: ["badge", "Choose looks"],
  generating: ["badge badge-live", "Developing"],
  reviewing: ["badge badge-live", "Grading"],
  done: ["badge badge-success", "Proofs ready"],
  error: ["badge badge-danger", "Needs attention"],
};

export function aiBanner() {
  const { vision, imaging } = state.ai;
  if (vision && imaging) return "";
  const missing = [!vision && "ANTHROPIC_API_KEY", !imaging && "GEMINI_API_KEY"].filter(Boolean);
  return html`<div class="banner banner-warn" role="status">${icon("circle-alert")}<div><b>The AI studio isn't switched on yet.</b>Add ${raw(missing.map((m) => `<code>${m}</code>`).join(" and "))} to the server environment and restart to check photos and develop real headshots. Sample shoots below still show the full experience.</div></div>`;
}

// Explains what the account can do right now (free shoot, demo, credits).
export function planBanner() {
  const plan = state.user?.plan;
  if (!plan) return "";
  if (plan.tier === "demo")
    return html`<div class="banner banner-info">${icon("info")}<div><b>You're exploring the demo account.</b>It's read-only, so you can browse the sample shoots. Create a free account to try it with your own photos; your first shoot is free.</div><a class="btn btn-sm btn-flash" href="/signup" data-link id="demoSignup">Create free account</a></div>`;
  if (plan.tier === "trial")
    return html`<div class="banner banner-info">${icon("sparkles")}<div><b>Your first shoot is free.</b>Up to 2 looks, which makes 4 headshots, each checked and graded by AI.</div></div>`;
  if (plan.tier === "none")
    return html`<div class="banner banner-warn">${icon("circle-alert")}<div><b>You've used your free shoot.</b>Paid packages are launching soon. Your existing shoots and downloads stay available.</div></div>`;
  if (plan.tier === "paid")
    return html`<div class="banner banner-info">${icon("check-circle-2")}<div><b>${plan.credits} shoot credit${plan.credits === 1 ? "" : "s"} available.</b>Each developed shoot uses one.</div></div>`;
  return "";
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export async function renderDashboard({ root }) {
  const first = state.user.name.split(" ")[0];
  root.innerHTML = html`<main id="main" class="container app-main">
    <div class="page-head">
      <div><p class="eyebrow">Your studio</p><h1 class="display h-1" style="margin-top:8px">${greeting()}, ${first}.</h1></div>
      <a class="btn btn-flash btn-lg" href="/app/new" data-link>${icon("plus")} New shoot</a>
    </div>
    ${aiBanner()}
    ${planBanner()}
    <div class="shoots" aria-busy="true">
      ${[0, 1, 2].map(() => html`<div class="shoot-card" style="pointer-events:none"><div class="shoot-cover skel" style="border-radius:0"></div><div class="shoot-body" style="display:block"><div class="skel skel-line" style="width:60%"></div><div class="skel skel-line" style="width:35%"></div></div></div>`)}
    </div>
  </main>`.v;

  const grid = root.querySelector(".shoots");
  let data;
  try {
    data = await api("/api/shoots");
  } catch (err) {
    grid.outerHTML = html`<div class="banner banner-danger">${icon("circle-alert")}<div><b>We couldn't load your shoots.</b>${err.message}</div><button class="btn btn-sm btn-ink" onclick="location.reload()">Try again</button></div>`.v;
    return;
  }
  grid.removeAttribute("aria-busy");

  if (!data.shoots.length) {
    grid.outerHTML = html`<div class="empty view-enter">
      <div class="empty-art" aria-hidden="true">${["e1", "e2", "e3"].map((s, i) => html`<div class="print"><img src="${portraitDataURL(s, { backdrop: ["studio-gray", "glass-office", "city-terrace"][i] })}" alt="" /><div class="print-cap"><b>0${i + 1}</b></div></div>`)}</div>
      <h2 class="display h-2">Your first shoot starts with a selfie.</h2>
      <p class="lede">Upload a few everyday photos. We'll check them, develop your headshots, and grade every frame.</p>
      <a class="btn btn-flash btn-lg" href="/app/new" data-link>Start your first shoot ${icon("arrow-right")}</a>
    </div>`.v;
    return;
  }

  grid.innerHTML = html`${data.shoots.map((s, i) => {
    const [cls, label] = STATUS[s.status] || STATUS.draft;
    return html`<a class="shoot-card view-enter" href="/app/shoot/${s.id}" data-link style="animation-delay:${i * 70}ms">
      <div class="shoot-cover">
        ${s.cover ? html`<img src="${media(s.cover)}" alt="" loading="lazy" />` : ""}
        <div class="badge-row"><span class="${cls}">${label}</span>${s.sample ? html`<span class="badge badge-ink">Sample</span>` : ""}</div>
      </div>
      <div class="shoot-body">
        <div>
          <h3>${s.name}</h3>
          <p class="muted small">${relTime(s.createdAt)} · ${s.doneCount ? `${s.doneCount} headshots` : `${s.selfieCount} photo${s.selfieCount === 1 ? "" : "s"}`}</p>
        </div>
        ${s.bestScore != null
          ? html`<span class="score-pill g-keeper" title="Best headshot score"><i></i>${s.bestScore}</span>`
          : s.checkScore != null
            ? html`<span class="score-pill g-solid" title="Photo check score"><i></i>${s.checkScore}</span>`
            : html`<span class="muted">${icon("arrow-right")}</span>`}
      </div>
    </a>`;
  })}
  <a class="new-card" href="/app/new" data-link><div><span class="plus">${icon("plus")}</span><p class="h-4" style="margin-top:12px;color:var(--text)">New shoot</p><p class="small">New looks, new photos</p></div></a>`.v;
}
