// Meta Pixel. Loads only when the server reports a Pixel ID (META_PIXEL_ID),
// and sends each event with the same event ID the server uses for the
// Conversions API, so Meta counts it once.
import { state } from "./core.js";

export function initPixel() {
  const id = state.meta?.pixelId;
  // Respect Global Privacy Control (a browser-level "don't share my data" signal).
  if (!id || window.fbq || navigator.globalPrivacyControl) return;
  /* eslint-disable */
  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  /* eslint-enable */
  window.fbq("init", id);
}

// The page an event happens on, sent with requests the server also reports to
// Meta (Conversions API). Path only: query strings can hold one-time tokens.
export const pageUrl = () => location.origin + location.pathname;

export function pixel(name, params = {}, eventId) {
  if (!window.fbq) return;
  window.fbq("track", name, params, eventId ? { eventID: eventId } : undefined);
}
