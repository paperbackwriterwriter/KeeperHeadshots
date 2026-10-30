import { $, html, icon, logoMark, wordmark, state, loadSession, api, toast, showRefundNotice, refreshUserChip, busy, initials, observeReveals, reduceMotion, updateReady, safeNext, SIGNED_OUT_MESSAGE, afterPaint } from "./core.js";
// Page code loads on demand, so each page downloads only its own view. (The
// server adds a modulepreload hint for the first page's view; lib/seo.js.)
const lazy = (load, name) => async (...args) => (await load())[name](...args);
const renderLanding = lazy(() => import("./views/landing.js"), "renderLanding");
const renderAuth = lazy(() => import("./views/auth.js"), "renderAuth");
const renderDashboard = lazy(() => import("./views/dashboard.js"), "renderDashboard");
const renderStudio = lazy(() => import("./views/studio.js"), "renderStudio");
const renderBuy = lazy(() => import("./views/buy.js"), "renderBuy");
const renderContact = lazy(() => import("./views/contact.js"), "renderContact");
const renderBlog = lazy(() => import("./views/blog.js"), "renderBlog");
const renderRefunds = lazy(() => import("./views/refunds.js"), "renderRefunds");
const renderPrivacy = lazy(() => import("./views/legal.js"), "renderPrivacy");
const renderTerms = lazy(() => import("./views/legal.js"), "renderTerms");
const renderAccount = lazy(() => import("./views/account.js"), "renderAccount");
const renderFunnel = lazy(() => import("./views/funnel.js"), "renderFunnel");
const renderShowcaseAdmin = lazy(() => import("./views/showcaseadmin.js"), "renderShowcaseAdmin");
const renderTeamAdmin = lazy(() => import("./views/teamadmin.js"), "renderTeamAdmin");
const renderJoin = lazy(() => import("./views/join.js"), "renderJoin");
const renderUnsubscribe = lazy(() => import("./views/unsubscribe.js"), "renderUnsubscribe");
const renderVerify = lazy(() => import("./views/verify.js"), "renderVerify");
const renderForgot = lazy(() => import("./views/password.js"), "renderForgot");
const renderReset = lazy(() => import("./views/password.js"), "renderReset");
const renderLinkedIn = lazy(() => import("./views/linkedin.js"), "renderLinkedIn");
const renderTeam = lazy(() => import("./views/team.js"), "renderTeam");
const renderRealEstate = lazy(() => import("./views/realestate.js"), "renderRealEstate");
const renderResume = lazy(() => import("./views/resume.js"), "renderResume");
const renderMedical = lazy(() => import("./views/medical.js"), "renderMedical");
const renderLegal = lazy(() => import("./views/legal-headshots.js"), "renderLegal");
import { initPixel, pixel, pixelRoute } from "./pixel.js";
import { initSearch, searchButton } from "./search.js";

const app = document.getElementById("app");
let cleanup = null;

const routes = [
  { path: /^\/$/, view: renderLanding, chrome: "marketing", title: "Professional AI Headshots from Selfies | Keeper Headshots" },
  { path: /^\/linkedin-headshots$/, view: renderLinkedIn, chrome: "marketing", title: "LinkedIn Headshots from Selfies | Keeper Headshots" },
  { path: /^\/blog(\/[\w-]+)?$/, view: renderBlog, chrome: "marketing", title: "Blog: headshot tips and guides · Keeper Headshots" },
  { path: /^\/team-headshots$/, view: renderTeam, chrome: "marketing", title: "Team Headshots for Companies | Keeper Headshots" },
  { path: /^\/real-estate-headshots$/, view: renderRealEstate, chrome: "marketing", title: "Real Estate Agent Headshots | Keeper Headshots" },
  { path: /^\/resume-headshots$/, view: renderResume, chrome: "marketing", title: "Résumé & CV Headshots from Selfies | Keeper Headshots" },
  { path: /^\/doctor-headshots$/, view: renderMedical, chrome: "marketing", title: "Doctor & Medical Headshots | Keeper Headshots" },
  { path: /^\/lawyer-headshots$/, view: renderLegal, chrome: "marketing", title: "Lawyer & Attorney Headshots | Keeper Headshots" },
  { path: /^\/refunds$/, view: renderRefunds, chrome: "marketing", title: "Money-back guarantee · Keeper Headshots" },
  { path: /^\/privacy$/, view: renderPrivacy, chrome: "marketing", title: "Privacy policy · Keeper Headshots" },
  { path: /^\/terms$/, view: renderTerms, chrome: "marketing", title: "Terms of service · Keeper Headshots" },
  { path: /^\/verify$/, view: renderVerify, chrome: "marketing", title: "Confirm your email · Keeper Headshots" },
  { path: /^\/forgot-password$/, view: renderForgot, chrome: "none", title: "Reset your password · Keeper Headshots" },
  { path: /^\/reset$/, view: renderReset, chrome: "none", title: "Choose a new password · Keeper Headshots" },
  { path: /^\/contact$/, view: renderContact, chrome: "marketing", title: "Contact us · Keeper Headshots" },
  { path: /^\/signin$/, view: (ctx) => renderAuth(ctx, "signin"), chrome: "none", guestOnly: true, title: "Sign in · Keeper Headshots" },
  { path: /^\/signup$/, view: (ctx) => renderAuth(ctx, "signup"), chrome: "none", guestOnly: true, title: "Create your account · Keeper Headshots" },
  { path: /^\/app$/, view: renderDashboard, chrome: "app", auth: true, title: "Your shoots · Keeper Headshots" },
  { path: /^\/app\/account$/, view: renderAccount, chrome: "app", auth: true, title: "Your account · Keeper Headshots" },
  { path: /^\/app\/funnel$/, view: renderFunnel, chrome: "app", auth: true, title: "Sales funnel · Keeper Headshots" },
  { path: /^\/app\/showcase$/, view: renderShowcaseAdmin, chrome: "app", auth: true, title: "Customer results · Keeper Headshots" },
  { path: /^\/app\/team$/, view: renderTeamAdmin, chrome: "app", auth: true, title: "Team headshots · Keeper Headshots" },
  { path: /^\/join$/, view: renderJoin, chrome: "marketing", title: "Team invitation · Keeper Headshots" },
  { path: /^\/unsubscribe$/, view: renderUnsubscribe, chrome: "none", title: "Reminder emails · Keeper Headshots" },
  { path: /^\/app\/buy\/([\w-]+)$/, view: (ctx, id) => renderBuy(ctx, id), chrome: "app", auth: true, title: "Checkout · Keeper Headshots" },
  { path: /^\/app\/new$/, view: (ctx) => renderStudio(ctx, null), chrome: "app", auth: true, title: "New shoot · Keeper Headshots" },
  { path: /^\/app\/shoot\/([\w-]+)$/, view: (ctx, id) => renderStudio(ctx, id), chrome: "app", auth: true, title: "Shoot · Keeper Headshots" },
];

// The app restores scroll itself (the browser's own restore would run before
// the page has re-rendered): each history entry remembers where it was left.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
// Remember the position once scrolling pauses, so Back and Forward both find
// it (a page left with the Back button has no link click to record it).
let scrollSave = null;
addEventListener(
  "scroll",
  () => {
    clearTimeout(scrollSave);
    scrollSave = setTimeout(() => {
      try {
        history.replaceState({ ...history.state, y: window.scrollY }, "");
      } catch {} // browsers rate-limit replaceState; losing one save is harmless
    }, 200);
  },
  { passive: true },
);

// Records where this entry was left, before a new one is pushed.
function saveScroll() {
  clearTimeout(scrollSave);
  try {
    history.replaceState({ ...history.state, y: window.scrollY }, "");
  } catch {}
}

export function navigate(to, { replace = false, silent = false } = {}) {
  if (to === location.pathname + location.search + location.hash && !replace) return;
  if (replace) clearTimeout(scrollSave);
  else saveScroll();
  history[replace ? "replaceState" : "pushState"]({}, "", to);
  // Overlays tied to the page being left (e.g. the iPhone save sheet) close.
  document.dispatchEvent(new CustomEvent("ahg:navigate"));
  if (!silent) render();
}

// An in-page anchor gets its own history entry; Back returns to where the
// page was before the jump.
function pushHash(url) {
  saveScroll();
  history.pushState({}, "", url);
}

function marketingNav() {
  const signedIn = !!state.user;
  return html`
  <header class="nav" id="nav">
    <div class="container nav-inner">
      <a class="logo" href="/" data-link>${logoMark()}${wordmark()}</a>
      <nav class="nav-links" aria-label="Primary">
        <a href="/#how">How it works</a><a href="/#styles">Looks</a><a href="/#pricing">Pricing</a><a href="/team-headshots" data-link>Teams</a><a href="/blog">Blog</a><a href="/#faq">FAQ</a>
      </nav>
      <div class="nav-actions">
        ${signedIn
          ? html`<a class="btn btn-ghost btn-sm hide-m" href="/app" data-link>Your shoots</a>`
          : html`<a class="btn btn-ghost btn-sm hide-m" href="/signin" data-link>Sign in</a>`}
        <a class="btn btn-flash btn-sm hide-m" href="${signedIn ? "/app/new" : "/signup"}" data-link>Get your headshots ${icon("arrow-right")}</a>
        ${searchButton()}
        <button class="btn btn-ghost btn-icon nav-toggle" id="navToggle" aria-expanded="false" aria-controls="navSheet" aria-label="Open menu">${icon("menu")}</button>
      </div>
    </div>
    <div class="nav-sheet" id="navSheet">
      <a href="/#how">How it works</a><a href="/#styles">Looks</a><a href="/#pricing">Pricing</a><a href="/team-headshots" data-link>Teams</a><a href="/blog">Blog</a><a href="/#faq">FAQ</a><a href="/contact" data-link>Contact</a>
      ${signedIn ? html`<a href="/app" data-link>Your shoots</a>` : html`<a href="/signin" data-link>Sign in</a>`}
      <a class="btn btn-flash btn-block" href="${signedIn ? "/app/new" : "/signup"}" data-link>Get your headshots ${icon("arrow-right")}</a>
    </div>
  </header>`;
}

function appNav() {
  const u = state.user;
  return html`
  <header class="nav" id="nav">
    <div class="container nav-inner">
      <a class="logo" href="/app" data-link>${logoMark()}${wordmark()}</a>
      <nav class="nav-links" aria-label="App">
        <a href="/app" data-link>Shoots</a><a href="/app/new" data-link>New shoot</a><a href="/#pricing">Pricing</a><a href="/contact" data-link>Contact</a><a href="/app/account" data-link>Account</a>
      </nav>
      <div class="nav-actions">
        <a class="user-chip" href="/app/account" data-link title="Your account (${u.email})" aria-label="Your account: ${u.name.split(" ")[0]}"><span class="avatar" data-initials="${initials(u.name)}" aria-hidden="true"></span><span class="hide-m">${u.name.split(" ")[0]}</span></a>
        <button class="btn btn-ghost btn-sm" id="signOut" aria-label="Sign out">${icon("log-out")}<span class="hide-m">Sign out</span></button>
        <button class="btn btn-ghost btn-icon nav-toggle" id="navToggle" aria-expanded="false" aria-controls="navSheet" aria-label="Open menu">${icon("menu")}</button>
      </div>
    </div>
    <div class="nav-sheet" id="navSheet">
      <a href="/app" data-link>Your shoots</a><a href="/#pricing">Pricing</a><a href="/contact" data-link>Contact</a><a href="/app/account" data-link>Account</a>
      <button type="button" class="nav-sheet-signout" data-signout>${icon("log-out")} Sign out</button>
      <a class="btn btn-flash btn-block" href="/app/new" data-link>${icon("plus")} New shoot</a>
    </div>
  </header>`;
}

let firstRender = true;
// After in-app navigation, move focus to the new page's heading so screen
// readers announce it (the first load is announced by the browser itself).
function focusHeading() {
  if (firstRender) return void (firstRender = false);
  // Leave focus alone when the view already placed it (e.g. a form's first
  // field) or the URL points at a section further down the page.
  if (location.hash || (document.activeElement && document.activeElement !== document.body)) return;
  const h = app.querySelector("main h1");
  if (!h) return;
  h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: true });
}

// Each render gets a number; an older render that finishes late (it was
// awaiting data when the person navigated on) discards itself.
let renderSeq = 0;
let lastRoute = null;

async function render({ restoreY = null } = {}) {
  const seq = ++renderSeq;
  lastRoute = location.pathname + location.search;
  cleanup?.();
  cleanup = null;
  // On the first load, public pages arrive with prerendered content (lib/seo.js).
  // Swap in the live view without replaying the entrance animations.
  const hydrating = firstRender && app.childElementCount > 0;
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const keepLanding = hydrating && path === "/" && !!app.querySelector("#view .hero");
  if (hydrating && !keepLanding) document.documentElement.classList.add("hydrating");
  let match;
  const route = routes.find((r) => (match = path.match(r.path)));
  if (!route) {
    document.title = "Not found · Keeper Headshots";
    app.innerHTML = html`${marketingNav()}<main id="main" class="container app-main view-enter"><div class="empty"><p class="eyebrow">Error 404</p><h1 class="display h-1">This frame didn't develop.</h1><p class="lede">The page you're looking for doesn't exist or has moved.</p><a class="btn btn-ink" href="/" data-link>Back to the studio ${icon("arrow-right")}</a></div></main>`.v;
    if (hydrating) document.documentElement.classList.remove("hydrating");
    wireChrome();
    focusHeading();
    return;
  }
  // Sign-in comes back to the same page, query included (e.g. /app/buy/pro?x).
  // Buying a package is how new customers start, so that goes to sign-up.
  if (route.auth && !state.user) return navigate(`/${path.startsWith("/app/buy/") ? "signup" : "signin"}?next=${encodeURIComponent(path + location.search)}`, { replace: true });
  // The demo's signup links must leave its shared session before opening
  // the guest-only form. Keep the URL (including a chosen package) intact.
  if (path === "/signup" && state.user?.demo) {
    try {
      await api("/api/auth/signout", { method: "POST" });
      state.user = null;
    } catch (err) {
      if (seq !== renderSeq) return;
      toast(`We couldn't leave the demo. ${err.message} Please try again.`, "error");
      return navigate("/app", { replace: true });
    }
    if (seq !== renderSeq) return;
  }
  if (route.guestOnly && state.user) {
    const next = new URLSearchParams(location.search).get("next");
    return navigate(safeNext(next) || "/app", { replace: true });
  }

  document.title = route.title;
  const chrome = route.chrome === "marketing" ? marketingNav() : route.chrome === "app" ? appNav() : html``;
  // The blog keeps what the server sent while the view is swapped in
  // (views/blog.js): the articles themselves, or the div Soro's embed fills.
  const keep = document.querySelector("[data-blog-ssr]") || document.getElementById("soro-blog");
  if (keepLanding) {
    if (state.user) $("#nav").outerHTML = chrome.v;
  } else app.innerHTML = html`${chrome}<div id="view"></div>`.v;
  const view = $("#view");
  if (keep) view.append(keep);
  const ctx = { root: view, hydrate: keepLanding, navigate, setTitle: (t) => (document.title = `${t} · Keeper Headshots`) };
  let viewCleanup = null;
  try {
    viewCleanup = (await route.view(ctx, ...(match?.slice(1) || []))) || null;
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    view.innerHTML = html`<main id="main" class="container app-main"><div class="banner banner-danger">${icon("circle-alert")}<div><b>This page failed to load.</b>${err.message}</div><button class="btn btn-sm btn-ink" type="button" data-reload>Reload</button></div></main>`.v;
  }
  if (seq !== renderSeq) return void viewCleanup?.();
  cleanup = viewCleanup;
  wireChrome();
  if (hydrating && !keepLanding) {
    // Content already on screen stays visible; the rest still reveals on scroll.
    app.querySelectorAll("[data-reveal]").forEach((el) => el.getBoundingClientRect().top < innerHeight && el.classList.add("in"));
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("hydrating")));
  }
  observeReveals(app);
  focusHeading();
  pixelRoute();
  pixel("PageView");
  if (restoreY != null) requestAnimationFrame(() => window.scrollTo({ top: restoreY, behavior: "instant" }));
  else if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  else window.scrollTo({ top: 0, behavior: "instant" });
}

// Scroll to (and focus) an in-page section without re-rendering the page.
function goToHash(hash) {
  const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!target) return;
  target.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
  if (!target.matches("a, button, input, select, textarea, [tabindex]")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

function wireChrome() {
  const nav = $("#nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
    requestAnimationFrame(onScroll); // after layout, not forcing one mid-render
    window.addEventListener("scroll", onScroll, { passive: true });
    // Collapse into the menu whenever the links don't fit on one line, whatever
    // the width: text-only zoom enlarges text without reaching the CSS
    // breakpoint. Measured again when the width or the text size changes.
    const inner = nav.querySelector(".nav-inner");
    let fitted = "";
    // Out of room: the row overflows, or (where a browser squeezes rather than
    // overflows, as WebKit can) the logo runs into the first visible control.
    const crowded = () => {
      if (inner.scrollWidth > inner.clientWidth + 1) return true;
      const logo = inner.querySelector(".logo")?.getBoundingClientRect();
      const first = [...inner.querySelectorAll(".nav-links, .nav-actions > *")].map((el) => el.getBoundingClientRect()).find((r) => r.width);
      return !!(logo && first && logo.right > first.left + 1);
    };
    const fit = () => {
      const key = `${inner.clientWidth}|${getComputedStyle(inner).fontSize}`;
      if (key === fitted) return;
      fitted = key;
      nav.classList.remove("nav-compact", "nav-tight", "nav-mark");
      if (crowded()) nav.classList.add("nav-compact");
      // Still no room (a phone with large text): sign-out moves into the menu.
      if (crowded()) nav.classList.add("nav-tight");
      // And on the narrowest phones, the logo is just its mark.
      if (crowded()) nav.classList.add("nav-mark");
    };
    const sizes = inner && typeof ResizeObserver === "function" ? new ResizeObserver(() => requestAnimationFrame(fit)) : null;
    sizes?.observe(document.documentElement);
    if (inner) requestAnimationFrame(fit);
    const prev = cleanup;
    cleanup = () => {
      window.removeEventListener("scroll", onScroll);
      sizes?.disconnect();
      prev?.();
    };
  }
  const toggle = $("#navToggle");
  const sheet = $("#navSheet");
  const setOpen = (open) => {
    sheet.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    toggle.innerHTML = icon(open ? "x" : "menu").v;
  };
  toggle?.addEventListener("click", () => {
    const open = !sheet.classList.contains("open");
    setOpen(open);
    if (open) sheet.querySelector("a")?.focus();
  });
  sheet?.addEventListener("click", (e) => e.target.closest("a") && setOpen(false));
  if (sheet && toggle) {
    // Closes on a tap outside it, on Escape wherever focus is, and when
    // keyboard focus moves past it (onto the page it covers).
    const inside = (el) => el && (sheet.contains(el) || toggle.contains(el));
    const isOpen = () => sheet.classList.contains("open");
    // The path the click took, not just its target: the toggle's icon is
    // replaced while the click is still on its way up (open ↔ close icon).
    const onClick = (e) => isOpen() && !e.composedPath().some((el) => el === sheet || el === toggle) && setOpen(false);
    const onKey = (e) => {
      if (e.key !== "Escape" || !isOpen()) return;
      setOpen(false);
      toggle.focus();
    };
    sheet.addEventListener("focusout", (e) => isOpen() && e.relatedTarget && !inside(e.relatedTarget) && setOpen(false));
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    const prev = cleanup;
    cleanup = () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      prev?.();
    };
  }
  // The header's button, or the menu's when the header has no room for it.
  document.querySelectorAll("#signOut, [data-signout]").forEach((b) => b.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const restore = busy(btn, "Signing out…");
    btn.querySelector("span")?.classList.add("hide-m");
    try {
      const result = await api("/api/auth/signout", { method: "POST" });
      if (result.ok !== true) throw new Error("Sign-out wasn't confirmed. Please try again.");
      state.user = null;
      toast("Signed out. See you soon.", "success");
      navigate("/");
    } catch (err) {
      toast(`We couldn't sign you out. ${err.message}`, "error");
    } finally {
      restore();
    }
  }));
}

// The account changed under an open page (email confirmed by code here or by
// link in another tab, a purchase elsewhere): plan banners are swapped in
// place and open pages re-check what the account can do, so nothing being
// worked on (photos picked, looks chosen) is lost to a re-render.
async function accountChanged() {
  const { planBanner, emptyDashboard } = await import("./views/dashboard.js");
  document.querySelectorAll("[data-plan-banner]").forEach((el) => {
    const next = planBanner(el.dataset.planBanner);
    el.outerHTML = next ? next.v : "";
  });
  // The empty dashboard's next step follows too (a package bought elsewhere).
  document.querySelectorAll("[data-empty-dash]").forEach((el) => (el.outerHTML = emptyDashboard().v));
  // The account page's "Confirm your email" panel goes once it's confirmed.
  if (state.user?.emailVerified) document.querySelectorAll("[data-verify-panel]").forEach((el) => el.remove());
  refreshUserChip();
  document.dispatchEvent(new CustomEvent("ahg:user-changed"));
  showRefundNotice();
}
const accountSig = (u) => JSON.stringify(u ? [u.id, u.emailVerified, u.plan, u.previewsUnlocked, u.kept, u.extraLooks, u.photoFormat, u.emailReminders, u.refundNotice, u.name] : null);
let lastAccountSync = 0;
async function syncAccount() {
  if (!state.user || document.visibilityState !== "visible" || Date.now() - lastAccountSync < 4000) return;
  lastAccountSync = Date.now();
  let data;
  try {
    data = await api("/api/me");
  } catch {
    return;
  }
  if (!data.user) return signedOut();
  if (accountSig(data.user) === accountSig(state.user)) return;
  // A different account signed in from another tab: nothing on this page is
  // theirs, so start over at their shoots.
  if (data.user.id !== state.user.id) {
    state.user = data.user;
    return location.pathname === "/app" ? render() : navigate("/app");
  }
  state.user = data.user;
  accountChanged();
}
// Coming back to the tab (after confirming the email in another one, paying
// on a phone…) checks the account again.
document.addEventListener("visibilitychange", syncAccount);
window.addEventListener("focus", syncAccount);

let signingOut = false;
function signedOut() {
  if (!state.user || signingOut) return;
  state.user = null;
  // Public pages only swap the nav (its sign-in buttons), so the reader's
  // place and the page itself stay as they are.
  if (!location.pathname.startsWith("/app")) {
    const nav = $("#nav");
    if (!nav) return render({ restoreY: window.scrollY });
    nav.outerHTML = marketingNav().v;
    return wireChrome();
  }
  signingOut = true;
  toast(SIGNED_OUT_MESSAGE, "info", 6000);
  navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
  setTimeout(() => (signingOut = false), 2000);
}
document.addEventListener("ahg:signed-out", signedOut);

// "Resend email" buttons (dashboard banner, account page, verify page) for email confirmation.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-resend-verify]");
  if (!btn || btn.disabled) return;
  const restore = busy(btn, "Sending…");
  try {
    const res = await api("/api/auth/verify/resend", { method: "POST" });
    if (res.status === "already") {
      state.user = res.user;
      toast(res.user?.plan?.freeShootAvailable ? "Your email is already confirmed. Your free shoot is ready." : "Your email is already confirmed.", "success");
      // On the verify page itself, re-running it would show "couldn't confirm".
      if (location.pathname === "/verify") return navigate("/app");
      return accountChanged();
    }
    toast(`Sent. Check ${res.email} for a code and link from hello@keeperheadshots.com.`, "success", 7000);
    btn.textContent = "Email sent";
  } catch (err) {
    restore();
    if (err.status === 401) return navigate(`/signin?next=${encodeURIComponent("/app")}`);
    toast(err.message, "error", 7000);
  }
});

// The 6-digit code from the confirmation email, typed into the banner
// (views/dashboard.js planBanner, or the account page). Confirms the signed-in account.
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-verify-code]");
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector("input");
  const err = form.querySelector(".field-error");
  const showError = (msg) => {
    err.textContent = msg || "";
    err.hidden = !msg;
    input.setAttribute("aria-invalid", msg ? "true" : "false");
  };
  const code = input.value.replace(/\D/g, "");
  if (code.length !== 6) return showError("Enter the 6 digits from the email."), input.focus();
  showError("");
  const restore = busy(form.querySelector("button[type=submit]"), "Checking…");
  try {
    const res = await api("/api/auth/verify/code", { method: "POST", body: { code } });
    state.user = res.user;
    if (res.status === "verified") pixel("CompleteRegistration", {}, res.eventId);
    toast(res.user?.plan?.freeShootAvailable ? "Email confirmed. Your free shoot is ready." : "Email confirmed. Thank you.", "success", 6000);
    // Swaps just the banners, so a page in progress (photos being picked on
    // /app/new) keeps its state.
    await accountChanged();
  } catch (e2) {
    restore();
    if (e2.status === 401) return navigate(`/signin?next=${encodeURIComponent(location.pathname)}`);
    showError(e2.message);
    input.focus();
  }
});

// Intercept in-app links.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link], a[href^='/']");
  if (e.defaultPrevented || !a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.hasAttribute("download")) return;
  const url = new URL(a.href, location.origin);
  // Files and server routes (e.g. /api/auth/google, which redirects to Google) load for real.
  if (url.origin !== location.origin || url.pathname.startsWith("/media/") || url.pathname.startsWith("/api/")) return;
  // The blog loads fresh: the server sends its articles (or allows Soro's
  // embed script there, which other pages don't).
  if (/^\/blog(\/|$)/.test(url.pathname) || /^\/blog(\/|$)/.test(location.pathname)) return;
  // A newer version was deployed since this tab loaded: load the page fresh.
  if (updateReady()) return;
  e.preventDefault();
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    pushHash(url.pathname + url.search + url.hash);
    goToHash(url.hash);
    return;
  }
  navigate(url.pathname + url.search + url.hash);
});
// Plain "#section" links (skip link, in-page anchors) scroll without a re-render.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href^='#']");
  if (!a || a.getAttribute("href").length < 2 || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  if (!document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)))) return;
  e.preventDefault();
  pushHash(location.pathname + location.search + a.getAttribute("href"));
  goToHash(a.getAttribute("href"));
});
document.addEventListener("click", (e) => e.target.closest("[data-reload]") && location.reload());
// Coming back from Stripe's hosted checkout with the Back button can restore
// this page from the browser's cache, still showing "Taking you to Stripe…".
window.addEventListener("pageshow", (e) => {
  if (e.persisted && location.pathname.startsWith("/app/buy/")) render();
});
// Back/forward between sections of the same page only scrolls.
// Back/forward to another page returns to where it was scrolled.
window.addEventListener("popstate", () => {
  clearTimeout(scrollSave); // a pending save belongs to the page just left
  if (location.pathname + location.search === lastRoute) {
    if (location.hash) return goToHash(location.hash);
    return window.scrollTo({ top: history.state?.y || 0, behavior: "instant" });
  }
  // A newer version was deployed since this tab loaded: load the page fresh
  // (as link clicks do) rather than mixing new views with old core code.
  if (updateReady()) return location.reload();
  render({ restoreY: history.state?.y });
});

// Vercel Web Analytics: cookieless visit counts. Production domain only. One-
// time tokens are already out of the URL by now (see below). It follows
// in-app navigation itself.
function loadAnalytics() {
  if (location.hostname !== "keeperheadshots.com" || window.va) return;
  window.va = (...args) => (window.vaq = window.vaq || []).push(args);
  const s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/insights/script.js";
  document.head.append(s);
}

// One-time tokens in email links (/verify?token=, /reset?token=) leave the
// address bar before any other script (Pixel, analytics) can read the URL.
// The views take the token from state.linkToken instead.
{
  const token = new URLSearchParams(location.search).get("token");
  if (token && ["/verify", "/reset"].includes(location.pathname)) {
    state.linkToken = token;
    history.replaceState({}, "", location.pathname);
  }
  // A team invitation carries its secret in the path (/join/<token>). It's
  // kept for this tab (it has to survive signing up on the way) and the
  // address becomes plain /join.
  const join = /^\/join\/([\w-]{20,60})$/.exec(location.pathname);
  if (join) {
    try {
      sessionStorage.setItem("ahg-join", join[1]);
    } catch {
      state.joinToken = join[1];
    }
    history.replaceState({}, "", "/join");
  }
}

// Coming back from "Continue with Google" (/api/auth/google/callback): the
// marker leaves the address bar, and a new or newly confirmed account sends
// the Pixel's CompleteRegistration with the server's event id.
const googleReturn = (() => {
  const params = new URLSearchParams(location.search);
  const kind = params.get("auth");
  if (!/^google(-new|-verified|-secured)?$/.test(kind || "")) return null;
  params.delete("auth");
  history.replaceState({}, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  return kind;
})();

loadSession()
  .catch(() => {})
  .finally(() => {
    // Not on a password reset link: nothing may see that URL's one-time token.
    const rendering = render();
    rendering.then(showRefundNotice);
    initSearch();
    if (location.pathname !== "/reset") initPixel({ afterRender: rendering });
    rendering.then(() => afterPaint(loadAnalytics));
    if (googleReturn && state.user) {
      const first = state.user.name.split(" ")[0];
      if (googleReturn === "google") toast(`Welcome back, ${first}.`, "success");
      // (server.js: Google linked for the first time on another browser.)
      else if (googleReturn === "google-secured") toast(`Welcome back, ${first}. To keep your account safe, we signed you out everywhere else and removed the old password. You can set a new one from your account page.`, "success", 9000);
      else {
        if (googleReturn === "google-new" && Date.now() - Date.parse(state.user.createdAt) < 10 * 60 * 1000) pixel("CompleteRegistration", {}, `reg_${state.user.id}`);
        // (The same welcome as an email sign-up: customers pay up front.)
        const fresh = state.user.plan?.tier === "none" && !state.user.plan.started;
        toast(googleReturn === "google-new" ? (fresh ? `Welcome, ${first}. Choose a package to start your first shoot.` : `Welcome, ${first}. Let's make some headshots.`) : `Welcome back, ${first}. Your email is confirmed.`, "success", 6000);
      }
    }
  });
