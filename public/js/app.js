import { $, html, icon, logoMark, wordmark, state, loadSession, api, toast, busy, initials, observeReveals, reduceMotion, updateReady } from "./core.js";
// Page code loads on demand, so each page downloads only its own view. (The
// server adds a modulepreload hint for the first page's view; lib/seo.js.)
const lazy = (load, name) => async (...args) => (await load())[name](...args);
const renderLanding = lazy(() => import("./views/landing.js"), "renderLanding");
const renderAuth = lazy(() => import("./views/auth.js"), "renderAuth");
const renderDashboard = lazy(() => import("./views/dashboard.js"), "renderDashboard");
const renderStudio = lazy(() => import("./views/studio.js"), "renderStudio");
const renderBuy = lazy(() => import("./views/buy.js"), "renderBuy");
const renderContact = lazy(() => import("./views/contact.js"), "renderContact");
const renderRefunds = lazy(() => import("./views/refunds.js"), "renderRefunds");
const renderPrivacy = lazy(() => import("./views/legal.js"), "renderPrivacy");
const renderTerms = lazy(() => import("./views/legal.js"), "renderTerms");
const renderAccount = lazy(() => import("./views/account.js"), "renderAccount");
const renderVerify = lazy(() => import("./views/verify.js"), "renderVerify");
const renderForgot = lazy(() => import("./views/password.js"), "renderForgot");
const renderReset = lazy(() => import("./views/password.js"), "renderReset");
const renderLinkedIn = lazy(() => import("./views/linkedin.js"), "renderLinkedIn");
const renderTeam = lazy(() => import("./views/team.js"), "renderTeam");
const renderRealEstate = lazy(() => import("./views/realestate.js"), "renderRealEstate");
const renderResume = lazy(() => import("./views/resume.js"), "renderResume");
const renderMedical = lazy(() => import("./views/medical.js"), "renderMedical");
const renderLegal = lazy(() => import("./views/legal-headshots.js"), "renderLegal");
import { initPixel, pixel } from "./pixel.js";

const app = document.getElementById("app");
let cleanup = null;

const routes = [
  { path: /^\/$/, view: renderLanding, chrome: "marketing", title: "Professional AI Headshots from Selfies | Keeper Headshots" },
  { path: /^\/linkedin-headshots$/, view: renderLinkedIn, chrome: "marketing", title: "LinkedIn Headshots from Selfies | Keeper Headshots" },
  { path: /^\/team-headshots$/, view: renderTeam, chrome: "marketing", title: "Team Headshots for Companies | Keeper Headshots" },
  { path: /^\/real-estate-headshots$/, view: renderRealEstate, chrome: "marketing", title: "Real Estate Agent Headshots | Keeper Headshots" },
  { path: /^\/resume-headshots$/, view: renderResume, chrome: "marketing", title: "Résumé & CV Headshots from Selfies | Keeper Headshots" },
  { path: /^\/doctor-headshots$/, view: renderMedical, chrome: "marketing", title: "Doctor & Medical Headshots | Keeper Headshots" },
  { path: /^\/lawyer-headshots$/, view: renderLegal, chrome: "marketing", title: "Lawyer & Attorney Headshots | Keeper Headshots" },
  { path: /^\/refunds$/, view: renderRefunds, chrome: "marketing", title: "Money-back guarantee · Keeper Headshots" },
  { path: /^\/privacy$/, view: renderPrivacy, chrome: "marketing", title: "Privacy policy · Keeper Headshots" },
  { path: /^\/terms$/, view: renderTerms, chrome: "marketing", title: "Terms of service · Keeper Headshots" },
  { path: /^\/verify$/, view: renderVerify, chrome: "marketing", title: "Confirm your email · Keeper Headshots" },
  { path: /^\/forgot-password$/, view: renderForgot, chrome: "marketing", title: "Reset your password · Keeper Headshots" },
  { path: /^\/reset$/, view: renderReset, chrome: "marketing", title: "Choose a new password · Keeper Headshots" },
  { path: /^\/contact$/, view: renderContact, chrome: "marketing", title: "Contact us · Keeper Headshots" },
  { path: /^\/signin$/, view: (ctx) => renderAuth(ctx, "signin"), chrome: "none", guestOnly: true, title: "Sign in · Keeper Headshots" },
  { path: /^\/signup$/, view: (ctx) => renderAuth(ctx, "signup"), chrome: "none", guestOnly: true, title: "Create your account · Keeper Headshots" },
  { path: /^\/app$/, view: renderDashboard, chrome: "app", auth: true, title: "Your shoots · Keeper Headshots" },
  { path: /^\/app\/account$/, view: renderAccount, chrome: "app", auth: true, title: "Your account · Keeper Headshots" },
  { path: /^\/app\/buy\/([\w-]+)$/, view: (ctx, id) => renderBuy(ctx, id), chrome: "app", auth: true, title: "Checkout · Keeper Headshots" },
  { path: /^\/app\/new$/, view: (ctx) => renderStudio(ctx, null), chrome: "app", auth: true, title: "New shoot · Keeper Headshots" },
  { path: /^\/app\/shoot\/([\w-]+)$/, view: (ctx, id) => renderStudio(ctx, id), chrome: "app", auth: true, title: "Shoot · Keeper Headshots" },
];

export function navigate(to, { replace = false, silent = false } = {}) {
  if (to === location.pathname + location.search + location.hash && !replace) return;
  history[replace ? "replaceState" : "pushState"]({}, "", to);
  if (!silent) render();
}

function marketingNav() {
  const signedIn = !!state.user;
  return html`
  <header class="nav" id="nav">
    <div class="container nav-inner">
      <a class="logo" href="/" data-link aria-label="Keeper Headshots home">${logoMark()}${wordmark()}</a>
      <nav class="nav-links" aria-label="Primary">
        <a href="/#how">How it works</a><a href="/#styles">Styles</a><a href="/#pricing">Pricing</a><a href="/team-headshots" data-link>Teams</a><a href="/#faq">FAQ</a>
      </nav>
      <div class="nav-actions">
        ${signedIn
          ? html`<a class="btn btn-ghost btn-sm hide-m" href="/app" data-link>Your shoots</a>`
          : html`<a class="btn btn-ghost btn-sm hide-m" href="/signin" data-link>Sign in</a>`}
        <a class="btn btn-flash btn-sm hide-m" href="${signedIn ? "/app/new" : "/signup"}" data-link>Get your headshots ${icon("arrow-right")}</a>
        <button class="btn btn-ghost btn-icon nav-toggle" id="navToggle" aria-expanded="false" aria-controls="navSheet" aria-label="Open menu">${icon("menu")}</button>
      </div>
    </div>
    <div class="nav-sheet" id="navSheet">
      <a href="/#how">How it works</a><a href="/#styles">Styles</a><a href="/#pricing">Pricing</a><a href="/team-headshots" data-link>Teams</a><a href="/#faq">FAQ</a><a href="/contact" data-link>Contact</a>
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
      <a class="logo" href="/app" data-link aria-label="Keeper Headshots — your shoots">${logoMark()}${wordmark()}</a>
      <nav class="nav-links" aria-label="App">
        <a href="/app" data-link>Shoots</a><a href="/app/new" data-link>New shoot</a><a href="/#pricing">Pricing</a><a href="/contact" data-link>Contact</a><a href="/app/account" data-link>Account</a>
      </nav>
      <div class="nav-actions">
        <a class="user-chip" href="/app/account" data-link title="Your account (${u.email})" aria-label="Your account"><span class="avatar" aria-hidden="true">${initials(u.name)}</span><span class="hide-m">${u.name.split(" ")[0]}</span></a>
        <button class="btn btn-ghost btn-sm" id="signOut" aria-label="Sign out">${icon("log-out")}<span class="hide-m">Sign out</span></button>
      </div>
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

async function render() {
  const seq = ++renderSeq;
  lastRoute = location.pathname + location.search;
  cleanup?.();
  cleanup = null;
  // On the first load, public pages arrive with prerendered content (lib/seo.js).
  // Swap in the live view without replaying the entrance animations.
  const hydrating = firstRender && app.childElementCount > 0;
  if (hydrating) document.documentElement.classList.add("hydrating");
  const path = location.pathname.replace(/\/+$/, "") || "/";
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
  if (route.auth && !state.user) return navigate(`/signin?next=${encodeURIComponent(path)}`, { replace: true });
  if (route.guestOnly && state.user) return navigate("/app", { replace: true });

  document.title = route.title;
  const chrome = route.chrome === "marketing" ? marketingNav() : route.chrome === "app" ? appNav() : html``;
  app.innerHTML = html`${chrome}<div id="view"></div>`.v;
  const view = $("#view");
  const ctx = { root: view, navigate, setTitle: (t) => (document.title = `${t} · Keeper Headshots`) };
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
  if (hydrating) {
    // Content already on screen stays visible; the rest still reveals on scroll.
    app.querySelectorAll("[data-reveal]").forEach((el) => el.getBoundingClientRect().top < innerHeight && el.classList.add("in"));
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("hydrating")));
  }
  observeReveals(app);
  focusHeading();
  pixel("PageView");
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
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
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const prev = cleanup;
    cleanup = () => {
      window.removeEventListener("scroll", onScroll);
      prev?.();
    };
  }
  const toggle = $("#navToggle");
  const sheet = $("#navSheet");
  const setOpen = (open) => {
    sheet.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  toggle?.addEventListener("click", () => {
    const open = !sheet.classList.contains("open");
    setOpen(open);
    if (open) sheet.querySelector("a")?.focus();
  });
  sheet?.addEventListener("click", (e) => e.target.closest("a") && setOpen(false));
  sheet?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    setOpen(false);
    toggle.focus();
  });
  $("#signOut")?.addEventListener("click", async () => {
    await api("/api/auth/signout", { method: "POST" }).catch(() => {});
    state.user = null;
    toast("Signed out. See you soon.", "success");
    navigate("/");
  });
}

// "Resend email" buttons (dashboard banner, verify page) for email confirmation.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-resend-verify]");
  if (!btn || btn.disabled) return;
  const restore = busy(btn, "Sending…");
  try {
    const res = await api("/api/auth/verify/resend", { method: "POST" });
    if (res.status === "already") {
      state.user = res.user;
      toast("Your email is already confirmed. Your free shoot is ready.", "success");
      return render();
    }
    toast(`Sent. Check ${res.email} for a link from hello@keeperheadshots.com.`, "success", 7000);
    btn.textContent = "Email sent";
  } catch (err) {
    restore();
    if (err.status === 401) return navigate(`/signin?next=${encodeURIComponent("/app")}`);
    toast(err.message, "error", 7000);
  }
});

// Intercept in-app links.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link], a[href^='/']");
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.hasAttribute("download")) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin || url.pathname.startsWith("/media/")) return;
  // A newer version was deployed since this tab loaded: load the page fresh.
  if (updateReady()) return;
  e.preventDefault();
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    history.pushState({}, "", url.pathname + url.search + url.hash);
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
  history.pushState({}, "", location.pathname + location.search + a.getAttribute("href"));
  goToHash(a.getAttribute("href"));
});
document.addEventListener("click", (e) => e.target.closest("[data-reload]") && location.reload());
// Back/forward between sections of the same page only scrolls.
window.addEventListener("popstate", () => {
  if (location.pathname + location.search === lastRoute) return goToHash(location.hash);
  render();
});

// Vercel Web Analytics: cookieless visit counts. Production domain only, and
// loaded after the first render so one-time tokens (e.g. /verify?token=) have
// already been removed from the URL. It follows in-app navigation itself.
function loadAnalytics() {
  if (location.hostname !== "keeperheadshots.com" || window.va) return;
  window.va = (...args) => (window.vaq = window.vaq || []).push(args);
  const s = document.createElement("script");
  s.defer = true;
  s.src = "/_vercel/insights/script.js";
  document.head.append(s);
}

loadSession()
  .catch(() => {})
  .finally(() => {
    // Not on a password reset link: nothing may see that URL's one-time token.
    if (location.pathname !== "/reset") initPixel();
    render();
    loadAnalytics();
  });
