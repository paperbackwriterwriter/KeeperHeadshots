import { $, html, icon, logoMark, wordmark, state, loadSession, api, toast, initials, observeReveals } from "./core.js";
import { renderLanding } from "./views/landing.js";
import { renderAuth } from "./views/auth.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderStudio } from "./views/studio.js";
import { renderBuy } from "./views/buy.js";
import { renderContact } from "./views/contact.js";
import { renderRefunds } from "./views/refunds.js";
import { renderPrivacy, renderTerms } from "./views/legal.js";
import { initPixel, pixel } from "./pixel.js";

const app = document.getElementById("app");
let cleanup = null;

const routes = [
  { path: /^\/$/, view: renderLanding, chrome: "marketing", title: "Keeper Headshots — Professional headshots, without the photo shoot" },
  { path: /^\/refunds$/, view: renderRefunds, chrome: "marketing", title: "Money-back guarantee · Keeper Headshots" },
  { path: /^\/privacy$/, view: renderPrivacy, chrome: "marketing", title: "Privacy policy · Keeper Headshots" },
  { path: /^\/terms$/, view: renderTerms, chrome: "marketing", title: "Terms of service · Keeper Headshots" },
  { path: /^\/contact$/, view: renderContact, chrome: "marketing", title: "Contact us · Keeper Headshots" },
  { path: /^\/signin$/, view: (ctx) => renderAuth(ctx, "signin"), chrome: "none", guestOnly: true, title: "Sign in · Keeper Headshots" },
  { path: /^\/signup$/, view: (ctx) => renderAuth(ctx, "signup"), chrome: "none", guestOnly: true, title: "Create your account · Keeper Headshots" },
  { path: /^\/app$/, view: renderDashboard, chrome: "app", auth: true, title: "Your shoots · Keeper Headshots" },
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
        <a href="/#how">How it works</a><a href="/#styles">Styles</a><a href="/#pricing">Pricing</a><a href="/#teams">Teams</a><a href="/#faq">FAQ</a>
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
      <a href="/#how">How it works</a><a href="/#styles">Styles</a><a href="/#pricing">Pricing</a><a href="/#teams">Teams</a><a href="/#faq">FAQ</a><a href="/contact" data-link>Contact</a>
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
        <a href="/app" data-link>Shoots</a><a href="/app/new" data-link>New shoot</a><a href="/#pricing">Pricing</a><a href="/contact" data-link>Contact</a>
      </nav>
      <div class="nav-actions">
        <span class="user-chip hide-m" title="${u.email}"><span class="avatar" aria-hidden="true">${initials(u.name)}</span>${u.name.split(" ")[0]}</span>
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
  const h = app.querySelector("main h1");
  if (!h) return;
  h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: true });
}

async function render() {
  cleanup?.();
  cleanup = null;
  const path = location.pathname.replace(/\/+$/, "") || "/";
  let match;
  const route = routes.find((r) => (match = path.match(r.path)));
  if (!route) {
    document.title = "Not found · Keeper Headshots";
    app.innerHTML = html`${marketingNav()}<main id="main" class="container app-main view-enter"><div class="empty"><p class="eyebrow">Error 404</p><h1 class="display h-1">This frame didn't develop.</h1><p class="lede">The page you're looking for doesn't exist or has moved.</p><a class="btn btn-ink" href="/" data-link>Back to the studio ${icon("arrow-right")}</a></div></main>`.v;
    return;
  }
  if (route.auth && !state.user) return navigate(`/signin?next=${encodeURIComponent(path)}`, { replace: true });
  if (route.guestOnly && state.user) return navigate("/app", { replace: true });

  document.title = route.title;
  const chrome = route.chrome === "marketing" ? marketingNav() : route.chrome === "app" ? appNav() : html``;
  app.innerHTML = html`${chrome}<div id="view"></div>`.v;
  const view = $("#view");
  const ctx = { root: view, navigate, setTitle: (t) => (document.title = `${t} · Keeper Headshots`) };
  try {
    cleanup = (await route.view(ctx, ...(match?.slice(1) || []))) || null;
  } catch (err) {
    console.error(err);
    view.innerHTML = html`<main id="main" class="container app-main"><div class="banner banner-danger">${icon("circle-alert")}<div><b>This page failed to load.</b>${err.message}</div><button class="btn btn-sm btn-ink" onclick="location.reload()">Reload</button></div></main>`.v;
  }
  wireChrome();
  observeReveals(app);
  focusHeading();
  pixel("PageView");
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  else window.scrollTo({ top: 0, behavior: "instant" });
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
  toggle?.addEventListener("click", () => {
    const open = sheet.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
  sheet?.addEventListener("click", (e) => e.target.closest("a") && sheet.classList.remove("open"));
  $("#signOut")?.addEventListener("click", async () => {
    await api("/api/auth/signout", { method: "POST" }).catch(() => {});
    state.user = null;
    toast("Signed out. See you soon.", "success");
    navigate("/");
  });
}

// Intercept in-app links.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link], a[href^='/']");
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.hasAttribute("download")) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin || url.pathname.startsWith("/media/")) return;
  e.preventDefault();
  if (url.pathname === location.pathname && url.hash) {
    history.pushState({}, "", url.pathname + url.hash);
    document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  navigate(url.pathname + url.search + url.hash);
});
window.addEventListener("popstate", render);

loadSession()
  .catch(() => {})
  .finally(() => {
    initPixel();
    render();
  });
