// Shared helpers: DOM templating, icons, API client, toasts, session state.

import { ICONS } from "./icons.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// Tagged template: interpolations are escaped unless wrapped with raw().
class Raw { constructor(v) { this.v = v; } }
export const raw = (v) => new Raw(v);
export function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.v;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.v : esc(x))).join("");
      else if (v === false || v == null) out += "";
      else out += esc(v);
    }
  });
  return new Raw(out);
}

export function icon(name, cls = "") {
  const body = ICONS[name];
  if (!body) return raw("");
  return raw(`<svg class="i-${name} ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);
}

export const logoMark = () =>
  raw(`<svg class="logo-mark" viewBox="0 0 100 100" aria-hidden="true"><path d="M8 30V8h22M70 8h22v22M92 70v22H70M30 92H8V70" fill="none" stroke="#b8893b" stroke-width="7"/><text x="50" y="71" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="62" font-weight="600" fill="currentColor">K</text></svg>`);

// Example headshots rendered by the studio (lib/examples.js), as WebP at the
// width they're shown (the server resizes once; the CDN caches it). Bump v to
// refresh caches. Allowed widths: 360, 600, 900.
export const example = (id, w = 600) => `/examples/${id}.webp?w=${w}&v=5`;

export const wordmark = () => raw(`<span class="logo-word"><b>Keeper</b> <span>Headshots</span></span>`);

// The brass grease-pencil loop photographers draw around the keeper frame.
export const greaseCircle = () =>
  raw(`<svg class="sheet-circle" viewBox="0 0 200 240" preserveAspectRatio="none" aria-hidden="true"><path d="M104 14 C 40 10, 10 60, 14 124 C 18 192, 60 230, 108 226 C 164 222, 192 176, 188 112 C 184 50, 150 16, 96 20 C 80 22, 70 26, 62 32"/></svg>`);

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("You appear to be offline. Check your connection and try again.", 0);
  }
  noteBuild(res.headers.get("x-app-build"));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Something went wrong (${res.status}).`, res.status, data);
  return data;
}

/* ---- New version check ----
   The page records which browser-code version it loaded (<meta name="app-build">)
   and every API response names the current one (lib/build.js). When they differ,
   a deploy happened since this tab loaded: the next in-app link does a full
   page load (app.js), and on /app pages a notice offers a reload. Nothing reloads by itself,
   so a half-filled form or an upload is never lost. */
const LOADED_BUILD = document.querySelector('meta[name="app-build"]')?.content || null;
let newBuild = false;
let lastBuildCheck = Date.now();
export const updateReady = () => newBuild;

function noteBuild(build) {
  lastBuildCheck = Date.now();
  if (!LOADED_BUILD || !build || build === LOADED_BUILD || newBuild) return;
  newBuild = true;
  // Public pages have nothing to lose: the next link loads the new version,
  // so only signed-in pages (/app) show the notice.
  if (!location.pathname.startsWith("/app")) return;
  const el = document.createElement("div");
  el.className = "toast update";
  el.innerHTML = `${icon("refresh-cw").v}<div>A new version of Keeper Headshots is ready.</div><button class="btn btn-sm btn-paper" type="button" data-reload>Reload</button><button class="toast-close" type="button" aria-label="Dismiss">${icon("x").v}</button>`;
  el.querySelector(".toast-close").addEventListener("click", () => el.remove());
  document.getElementById("toasts")?.appendChild(el);
}

// A tab that sits idle makes no API calls, so check when it comes back into
// view (at most every 10 minutes).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || newBuild || Date.now() - lastBuildCheck < 10 * 60 * 1000) return;
  lastBuildCheck = Date.now();
  fetch("/api/version", { credentials: "same-origin" }).then((r) => noteBuild(r.headers.get("x-app-build"))).catch(() => {});
});

export const state = { user: null, ai: { vision: false, imaging: false }, meta: {}, turnstile: {}, stripe: {} };

export async function loadSession() {
  const data = await api("/api/me");
  state.user = data.user;
  state.ai = data.ai;
  state.meta = data.meta || {};
  state.turnstile = data.turnstile || {};
  state.stripe = data.stripe || {};
  return data;
}

// Errors stay longer (at least 8 s) and every message can be dismissed; the
// timer pauses while the pointer or keyboard focus is on the message.
export function toast(message, kind = "info", ms = 4200) {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const ic = kind === "error" ? "circle-alert" : kind === "success" ? "check-circle-2" : "info";
  el.innerHTML = `${icon(ic).v}<div>${esc(message)}</div><button class="toast-close" type="button" aria-label="Dismiss">${icon("x").v}</button>`;
  host.appendChild(el);
  const close = () => {
    if (el.classList.contains("out")) return;
    clearTimeout(timer);
    // Dismissed from the keyboard: focus goes back where it was, not to <body>.
    if (el.contains(document.activeElement)) {
      let to = returnTo?.isConnected ? returnTo : document.querySelector("main h1");
      if (to && to.tabIndex < 0 && !to.hasAttribute("tabindex")) to.tabIndex = -1;
      to?.focus({ preventScroll: true });
    }
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 600); // reduced motion: no animationend
  };
  el.querySelector(".toast-close").addEventListener("click", close);
  let timer = setTimeout(close, kind === "error" ? Math.max(ms, 8000) : ms);
  // Paused while hovered or focused; it resumes only once neither holds.
  let hovered = false;
  let returnTo = null;
  const pause = () => clearTimeout(timer);
  const resume = () => {
    clearTimeout(timer);
    if (!hovered && !el.contains(document.activeElement)) timer = setTimeout(close, 3000);
  };
  el.addEventListener("mouseenter", () => ((hovered = true), pause()));
  el.addEventListener("mouseleave", () => ((hovered = false), resume()));
  el.addEventListener("focusin", (e) => {
    if (!el.contains(e.relatedTarget)) returnTo = e.relatedTarget;
    pause();
  });
  el.addEventListener("focusout", (e) => !el.contains(e.relatedTarget) && setTimeout(resume));
}

export const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function observeReveals(root = document) {
  const els = $$("[data-reveal]:not(.in), .sheet-circle:not(.in)", root);
  if (reduceMotion() || !("IntersectionObserver" in window)) {
    els.forEach((e) => e.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      }),
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  els.forEach((e) => io.observe(e));
}

// Media files are "<shootId>/<name>.jpg"; both parts are URL-safe by construction.
export const media = (file, download = false) => (file ? `/media/${file.split("/").map(encodeURIComponent).join("/")}${download ? "?download=1" : ""}` : "");
// 1:1 square version for LinkedIn / Microsoft Teams profile photos.
export const squareMedia = (file) => (file ? `/media/${file.split("/").map(encodeURIComponent).join("/")}?square=1&download=1` : "");
// Ready-made sizes (server.js SIZES): "linkedin" 800×800, "banner" 1584×396,
// "signature" 256px round PNG.
export const sizeMedia = (file, size) => (file ? `/media/${file.split("/").map(encodeURIComponent).join("/")}?size=${size}&download=1` : "");
// For the profile-kit links: what each size is, in the words people use.
export const PROFILE_KIT = [
  ["linkedin", "LinkedIn photo", "800 × 800, face centered for the round frame"],
  ["banner", "LinkedIn banner", "1584 × 396, in the colours of this backdrop"],
  ["signature", "Email signature", "Round PNG, 256 px, transparent corners"],
];

export function relTime(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} hr ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} day${d >= 172800 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const spinner = () =>
  raw(`<svg class="spinner" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="3"/><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`);

// Put a button into a busy state and return a restore function.
export function busy(btn, label) {
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `${spinner().v}<span>${esc(label)}</span>`;
  return () => {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.innerHTML = prev;
  };
}

export const silhouette = () =>
  raw(`<svg class="silhouette" viewBox="0 0 100 110" aria-hidden="true"><circle cx="50" cy="34" r="22" fill="currentColor"/><path d="M6 110c2-28 20-44 44-44s42 16 44 44z" fill="currentColor"/></svg>`);

// Where sign-in may send people back to: an app page or a team invitation,
// on this site only.
export const safeNext = (next) => (typeof next === "string" && /^\/(app(\/|$|\?)|join$)/.test(next) ? next : null);
