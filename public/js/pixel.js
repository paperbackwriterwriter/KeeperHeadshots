// Meta Pixel. Loads only when the server reports a Pixel ID (META_PIXEL_ID),
// and sends each event with the same event ID the server uses for the
// Conversions API, so Meta counts it once.
import { state, afterPaint } from "./core.js";

// Either the request header or the browser property can carry the opt-out.
const optedOut = () => state.meta?.optOut || navigator.globalPrivacyControl;

export function initPixel({ afterRender } = {}) {
  const id = state.meta?.pixelId;
  // Respect Global Privacy Control (a browser-level "don't share my data" signal).
  if (!id || window.fbq || optedOut()) return;
  /* eslint-disable */
  !(function (f, n) {
    if (f.fbq) return;
    n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
  })(window);
  /* eslint-enable */
  // No automatic event setup (Meta scanning the page and wiring up buttons):
  // every event is sent explicitly, and conversions also go server-side. And
  // no automatic PageView on in-app navigation: the app sends its own on each
  // page, so Meta's would count each one twice.
  window.fbq.disablePushState = true;
  window.fbq("set", "autoConfig", false, id);
  window.fbq("init", id);
  const load = () => {
    if (optedOut()) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.append(script);
  };
  // Install the event queue immediately. The SDK (fbevents.js) is large and
  // runs long tasks on load, so it waits for the visitor's first interaction,
  // or for the page to have loaded and stayed quiet a few seconds, whichever
  // comes first. Queued events are sent once it loads; sign-ups, checkouts and
  // purchases also reach Meta from the server (Conversions API, same event IDs).
  if (afterRender) afterRender.then(() => afterPaint(() => whenActiveOrIdle(load)));
  else load();
}

export const PIXEL_IDLE_MS = 4000;
const ACTIVITY = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"];
function whenActiveOrIdle(task) {
  let done = false;
  let timer = null;
  const opts = { passive: true, capture: true };
  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    ACTIVITY.forEach((e) => window.removeEventListener(e, onActive, opts));
    task();
  };
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(run, { timeout: 2000 }) : run());
  // Not inside the interaction itself: once the browser is idle (or 3 s on).
  const onActive = () => (window.requestIdleCallback ? requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 0));
  ACTIVITY.forEach((e) => window.addEventListener(e, onActive, opts));
  const start = () => (timer = setTimeout(idle, PIXEL_IDLE_MS));
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

// The page an event happens on, sent with requests the server also reports to
// Meta (Conversions API). Path only: query strings can hold one-time tokens.
export const pageUrl = () => location.origin + location.pathname;

export function pixel(name, params = {}, eventId) {
  if (!window.fbq || optedOut()) return;
  window.fbq("track", name, params, eventId ? { eventID: eventId } : undefined);
}
