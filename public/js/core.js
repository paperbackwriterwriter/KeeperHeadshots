// Shared helpers: DOM templating, icons, API client, toasts, session state.

import { ICONS } from "/js/icons.js";

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

export const wordmark = () => raw(`<span class="logo-word"><b>Keeper</b><span>HEADSHOTS</span></span>`);

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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Something went wrong (${res.status}).`, res.status, data);
  return data;
}

export const state = { user: null, ai: { vision: false, imaging: false }, meta: {}, turnstile: {} };

export async function loadSession() {
  const data = await api("/api/me");
  state.user = data.user;
  state.ai = data.ai;
  state.meta = data.meta || {};
  state.turnstile = data.turnstile || {};
  return data;
}

export function toast(message, kind = "info", ms = 4200) {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const ic = kind === "error" ? "circle-alert" : kind === "success" ? "check-circle-2" : "info";
  el.innerHTML = `${icon(ic).v}<div>${esc(message)}</div>`;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, ms);
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
