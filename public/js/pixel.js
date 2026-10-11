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
  window.fbq("init", id);
  const load = () => {
    if (optedOut()) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.append(script);
  };
  // Install the event queue immediately; fetch/evaluate the SDK after the
  // first view has rendered and painted, preserving its queued events.
  if (afterRender) afterRender.then(() => afterPaint(load));
  else load();
}

// The page an event happens on, sent with requests the server also reports to
// Meta (Conversions API). Path only: query strings can hold one-time tokens.
export const pageUrl = () => location.origin + location.pathname;

export function pixel(name, params = {}, eventId) {
  if (!window.fbq || optedOut()) return;
  window.fbq("track", name, params, eventId ? { eventID: eventId } : undefined);
}
