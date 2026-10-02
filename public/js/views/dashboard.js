import { html, icon, api, state, media, relTime, toast, example, spinner } from "../core.js";
import { pixel } from "../pixel.js";

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
  return html`<div class="banner banner-warn" role="status">${icon("circle-alert")}<div><b>The AI studio is temporarily unavailable.</b>Photo checks and new shoots will be back shortly. Sample shoots below still show the full experience.</div></div>`;
}

// Explains what the account can do right now (free shoot, demo, credits).
export function planBanner() {
  const plan = state.user?.plan;
  if (!plan) return "";
  if (plan.tier === "demo")
    return html`<div class="banner banner-info">${icon("info")}<div><b>You're exploring the demo account.</b>It's read-only, so you can browse the sample shoots. Create a free account to try it with your own photos; your first shoot is free.</div><a class="btn btn-sm btn-flash" href="/signup" data-link id="demoSignup">Create free account</a></div>`;
  if (plan.needsEmail)
    return html`<div class="banner banner-warn verify-banner">${icon("mail")}<div><b>Confirm your email to unlock your free shoot.</b>We emailed a 6-digit code to ${state.user.email}. Enter it here, or click the link in the email. Can't find it? Check your spam folder.
      <form class="verify-code" data-verify-code novalidate>
        <label class="sr-only" for="verifyCode">6-digit code</label>
        <input class="input" id="verifyCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" placeholder="123 456" aria-describedby="verifyCodeErr" />
        <button class="btn btn-flash" type="submit">Confirm</button>
        <span class="field-error" id="verifyCodeErr" role="alert" hidden></span>
      </form>
      <p class="verify-resend">Didn't get it? <button class="link-btn" type="button" data-resend-verify>Resend email</button></p></div></div>`;
  if (plan.tier === "trial")
    return html`<div class="banner banner-info">${icon("sparkles")}<div><b>Your first shoot is a free preview.</b>Up to 2 looks, which makes 4 headshots, each checked and graded by AI. They're watermarked until you buy any package.</div></div>`;
  if (plan.tier === "none")
    return html`<div class="banner banner-warn">${icon("circle-alert")}<div><b>You're out of shoots.</b>Buy a package to develop more. Your existing shoots and downloads stay available.</div><a class="btn btn-sm btn-flash" href="/#pricing">Buy shoots</a></div>`;
  if (plan.tier === "paid")
    return html`<div class="banner banner-info">${icon("check-circle-2")}<div><b>${plan.credits} shoot${plan.credits === 1 ? "" : "s"} available.</b>Each developed shoot uses one, with up to 4 looks (8 headshots).</div><a class="btn btn-sm btn-ghost" href="/#pricing">Buy more</a></div>`;
  return "";
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// Returning from Stripe Checkout: confirm the payment and add the shoots.
async function handleCheckoutReturn(navigate, root) {
  const q = new URLSearchParams(location.search);
  const outcome = q.get("checkout");
  if (!outcome) return false;
  navigate("/app", { replace: true, silent: true });
  if (outcome === "cancelled") {
    toast("Checkout cancelled. You haven't been charged.", "info");
    return false;
  }
  // Something on screen while the payment is confirmed (a second or two).
  root.innerHTML = html`<main id="main" class="container app-main"><div class="empty" aria-busy="true"><div style="display:flex;justify-content:center">${spinner()}</div><h1 class="display h-2">Confirming your payment…</h1></div></main>`.v;
  try {
    const res = await api("/api/billing/confirm", { method: "POST", body: { sessionId: q.get("session_id") } });
    state.user = res.user;
    if (res.added) {
      // No Purchase event for a free (100%-off) order; the server sends none either.
      if (res.eventId) pixel("Purchase", { value: res.value, currency: "USD" }, res.eventId);
      toast(`${res.eventId ? "Payment received" : "Order complete"}: ${res.added} shoots added to your account.`, "success", 7000);
    }
    else if (!res.paid) toast("Your payment is still processing. Your shoots will appear as soon as it clears.", "info", 7000);
    return true;
  } catch (err) {
    toast(err.message, "error", 7000);
    return false;
  }
}

export async function renderDashboard({ root, navigate }) {
  if (!(await handleCheckoutReturn(navigate, root))) {
    // Pick up any purchase whose return trip didn't finish (e.g. closed tab).
    api("/api/billing/sync", { method: "POST" })
      .then((res) => {
        if (res.added || res.removed) {
          state.user = res.user;
          if (res.added) toast(`${res.added} purchased shoots added to your account.`, "success", 7000);
          // Refresh the dashboard only if the person is still on it.
          if (location.pathname === "/app") navigate("/app", { replace: true });
        }
      })
      .catch(() => {});
  }
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
    grid.outerHTML = html`<div class="banner banner-danger">${icon("circle-alert")}<div><b>We couldn't load your shoots.</b>${err.message}</div><button class="btn btn-sm btn-ink" type="button" data-reload>Try again</button></div>`.v;
    return;
  }
  grid.removeAttribute("aria-busy");

  if (!data.shoots.length) {
    grid.outerHTML = html`<div class="empty view-enter">
      <div class="empty-art" aria-hidden="true">${["strip-1", "hero-2", "strip-3"].map((s, i) => html`<div class="print"><img src="${example(s)}" alt="" /><div class="print-cap"><b>0${i + 1}</b></div></div>`)}</div>
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
          <h2>${s.name}</h2>
          <p class="muted small">${relTime(s.createdAt)} · ${s.doneCount ? `${s.doneCount} headshot${s.doneCount === 1 ? "" : "s"}` : `${s.selfieCount} photo${s.selfieCount === 1 ? "" : "s"}`}</p>
        </div>
        ${s.bestScore != null
          ? html`<span class="score-pill g-keeper" title="Best headshot score" role="img" aria-label="Best headshot score ${s.bestScore} out of 100"><i></i>${s.bestScore}</span>`
          : s.checkScore != null
            ? html`<span class="score-pill g-solid" title="Photo check score" role="img" aria-label="Photo check score ${s.checkScore} out of 100"><i></i>${s.checkScore}</span>`
            : html`<span class="muted">${icon("arrow-right")}</span>`}
      </div>
    </a>`;
  })}
  <a class="new-card" href="/app/new" data-link><div><span class="plus">${icon("plus")}</span><p class="h-4" style="margin-top:12px;color:var(--text)">New shoot</p><p class="small">New looks, new photos</p></div></a>`.v;
}
