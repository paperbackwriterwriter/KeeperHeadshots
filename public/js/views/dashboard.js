import { html, icon, api, state, media, relTime, toast, example, spinner, busy } from "../core.js";
import { pixel } from "../pixel.js";
import { PACKAGES, MIN_CHECK_SCORE } from "../shared/catalog.js";

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

// Explains what the account can do right now (packages, demo, credits).
// `mode` "blocked": only while the account can't develop (the banner goes
// once it can). Marked data-plan-banner so app.js can swap it in place when
// the account changes (email confirmed in another tab, a purchase).
export function planBanner(mode = "always") {
  const plan = state.user?.plan;
  if (!plan || (mode === "blocked" && plan.canDevelop)) return "";
  if (plan.tier === "demo")
    return html`<div class="banner banner-info" data-plan-banner="${mode}">${icon("info")}<div><b>You're exploring the demo account.</b>It's read-only, so you can browse the sample shoots. To use your own photos, create an account and choose a package; your first package is covered by our money-back guarantee.</div><a class="btn btn-sm btn-flash" href="/signup" data-link id="demoSignup">Create account</a></div>`;
  if (plan.needsEmail)
    return html`<div class="banner banner-warn verify-banner" data-plan-banner="${mode}">${icon("mail")}<div><b>Confirm your email to unlock your free shoot.</b>Confirm ${state.user.email} with the 6-digit code or link in your confirmation email. You can request an email below. Check your spam folder too.
      <form class="verify-code" data-verify-code novalidate>
        <label class="sr-only" for="verifyCode">6-digit code</label>
        <input class="input" id="verifyCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" placeholder="123 456" aria-describedby="verifyCodeErr" />
        <button class="btn btn-flash" type="submit">Confirm</button>
        <span class="field-error" id="verifyCodeErr" role="alert" hidden></span>
      </form>
      <p class="verify-resend">Need an email? <button class="link-btn" type="button" data-resend-verify>Send confirmation email</button></p></div></div>`;
  if (plan.tier === "trial")
    return html`<div class="banner banner-info" data-plan-banner="${mode}">${icon("sparkles")}<div><b>Your first shoot is a free preview.</b>Up to 2 looks, which makes 4 headshots, each checked and graded by AI.</div></div>`;
  // Invited by a team: that shoot is the team's; more of their own need a package.
  if (plan.tier === "none" && plan.teamMember)
    return html`<div class="banner banner-info" data-plan-banner="${mode}">${icon("users")}<div><b>Your team has paid for your headshot shoot.</b>To start more shoots of your own, choose a package.</div><a class="btn btn-sm btn-ghost" href="/#pricing">See packages</a></div>`;
  // A brand-new customer (never bought, never had a free shoot): packages come first.
  if (plan.tier === "none" && !plan.started)
    return html`<div class="banner banner-info" data-plan-banner="${mode}">${icon("sparkles")}<div><b>Choose a package to start.</b>Packages start at $${PACKAGES[0].price} for ${PACKAGES[0].shoots} shoots. Each shoot has up to 4 looks and 8 headshots, no watermark, and your first package is covered by our <a class="link" href="/refunds" data-link>money-back guarantee</a>.</div><a class="btn btn-sm btn-flash" href="/#pricing">See packages</a></div>`;
  if (plan.tier === "none")
    return html`<div class="banner banner-warn" data-plan-banner="${mode}">${icon("circle-alert")}<div><b>You're out of shoots.</b>Buy a package to develop more. Your shoots stay in your account.</div><a class="btn btn-sm btn-flash" href="/#pricing">Buy shoots</a></div>`;
  if (plan.tier === "paid")
    return html`<div class="banner banner-info" data-plan-banner="${mode}">${icon("check-circle-2")}<div><b>${plan.credits} shoot${plan.credits === 1 ? "" : "s"} available.</b>Each developed shoot uses one, with up to 4 looks (8 headshots).</div><a class="btn btn-sm btn-ghost" href="/#pricing">Buy more</a></div>`;
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
  return (await confirmPurchase(q.get("session_id"))) !== null;
}

// Confirms a checkout Stripe sent the customer back from (the dashboard, or
// a shoot's page for a preview offer): updates the account, sends the Pixel
// Purchase and says what was bought. Returns the result, or null on failure.
export async function confirmPurchase(sessionId) {
  try {
    const res = await api("/api/billing/confirm", { method: "POST", body: { sessionId } });
    state.user = res.user;
    // Paid, whether this call granted it or Stripe's webhook got there first
    // (it often does): say so either way.
    if (res.granted || res.paid) {
      // No Purchase event for a free (100%-off) order; the server sends none either.
      // Meta de-duplicates it with the server's event by its id.
      // A success page opened again later (history, a bookmark): the order
      // was applied back then, nothing is added now, and it isn't a purchase
      // again. Stripe's webhook getting there seconds before this call is
      // still "added".
      if (!res.granted && res.appliedAt && Date.now() - Date.parse(res.appliedAt) > 2 * 60 * 1000) {
        toast("This payment was already applied to your account.", "info", 7000);
        return res;
      }
      if (res.eventId) pixel("Purchase", { value: res.value, currency: "USD" }, res.eventId);
      const pkg = PACKAGES.find((p) => p.id === res.packageId);
      const what = res.added || pkg ? `${res.added || pkg.shoots} shoots added to your account.` : res.packageId === "keep-plus" ? "every headshot is yours to keep. Now pick your 2 extra looks." : "your pick is yours to keep, in full resolution.";
      toast(`${res.eventId ? "Payment received" : "Order complete"}: ${what}`, "success", 7000);
    } else toast("Your payment is still processing. Your order will appear as soon as it clears.", "info", 7000);
    return res;
  } catch (err) {
    toast(err.message, "error", 7000);
    return null;
  }
}

export async function renderDashboard({ root, navigate }) {
  if (!(await handleCheckoutReturn(navigate, root))) {
    // Pick up any purchase whose return trip didn't finish (e.g. closed tab).
    api("/api/billing/sync", { method: "POST", body: { automatic: true } })
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
  // The account changed while listing (marked as a team member): its banner too.
  if (data.user) {
    state.user = data.user;
    const banner = planBanner();
    root.querySelector("[data-plan-banner]")?.replaceWith(document.createRange().createContextualFragment(banner ? banner.v : ""));
  }

  if (!data.shoots.length && !data.nextCursor) {
    grid.outerHTML = html`<div class="empty view-enter">
      <div class="empty-art" aria-hidden="true">${["strip-1", "hero-2", "strip-3"].map((s, i) => html`<div class="print"><img src="${example(s)}" alt="" /><div class="print-cap"><b>0${i + 1}</b></div></div>`)}</div>
      <h2 class="display h-2">Your first shoot starts with a selfie.</h2>
      <p class="lede">Upload a few everyday photos. We'll check them, develop your headshots, and grade every frame.</p>
      <a class="btn btn-flash btn-lg" href="/app/new" data-link>Start your first shoot ${icon("arrow-right")}</a>
    </div>`.v;
    return;
  }

  const cards = (items) => html`${items.map((s, i) => {
    // A set scoring under the minimum can't go on to looks until it's retaken.
    const [cls, label] = s.status === "checked" && s.checkScore != null && s.checkScore < MIN_CHECK_SCORE ? ["badge badge-danger", "Retake needed"] : STATUS[s.status] || STATUS.draft;
    return html`<a class="shoot-card view-enter" href="/app/shoot/${s.id}" data-link style="animation-delay:${Math.min(i, 8) * 70}ms">
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
  })}`;
  grid.innerHTML = html`${cards(data.shoots)}
  <a class="new-card" href="/app/new" data-link><div><span class="plus">${icon("plus")}</span><p class="h-4" style="margin-top:12px;color:var(--text)">New shoot</p><p class="small">New looks, new photos</p></div></a>`.v;
  const more = document.createElement("div");
  more.style.cssText = "margin-top:24px;display:flex;justify-content:center";
  more.innerHTML = html`<button class="btn btn-ink" type="button">Show more shoots ${icon("arrow-down")}</button>`.v;
  grid.after(more);
  let cursor = data.nextCursor;
  more.hidden = !cursor;
  const button = more.querySelector("button");
  button.addEventListener("click", async () => {
    const restore = busy(button, "Loading shoots…");
    try {
      const page = await api(`/api/shoots?${new URLSearchParams({ cursor })}`);
      if (!grid.isConnected) return;
      grid.querySelector(".new-card").insertAdjacentHTML("beforebegin", cards(page.shoots).v);
      cursor = page.nextCursor;
      more.hidden = !cursor;
    } catch (err) { if (grid.isConnected) toast(err.message, "error"); }
    finally { restore(); }
  });

  // A shoot can be checked or developed from another tab or device: while this
  // tab is in view, check back every 15 seconds while one is in progress and
  // every minute otherwise, and once whenever the tab comes back into view.
  // Redraw on a change.
  const sig = (list) => list.map((s) => `${s.id}:${s.status}:${s.bestScore ?? ""}:${s.checkScore ?? ""}`).join();
  const inProgress = () => data.shoots.some((s) => ["checking", "generating", "reviewing"].includes(s.status));
  let checking = false;
  const refresh = async () => {
    if (!grid.isConnected || checking || document.visibilityState !== "visible") return;
    checking = true;
    try {
      const fresh = await api("/api/shoots");
      if (grid.isConnected && location.pathname === "/app" && sig(fresh.shoots) !== sig(data.shoots)) navigate("/app", { replace: true });
    } catch {} finally { checking = false; }
  };
  const onVisible = () => (grid.isConnected ? refresh() : document.removeEventListener("visibilitychange", onVisible));
  document.addEventListener("visibilitychange", onVisible);
  let ticks = 0;
  const timer = setInterval(() => {
    if (!grid.isConnected) return clearInterval(timer);
    if (inProgress() || ++ticks % 4 === 0) refresh();
  }, 15000);
}
