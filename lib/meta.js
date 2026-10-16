// Meta (Facebook/Instagram) conversion tracking, server side (Conversions API).
// The browser Pixel sends the same events with the same event_id, so Meta
// counts each one once but still receives it when the browser event is lost
// (ad blockers, iOS privacy). Everything here is a no-op unless
// META_PIXEL_ID and META_CAPI_TOKEN are set.

import crypto from "node:crypto";
import { background } from "./pipeline.js";

export const metaPixelId = () => process.env.META_PIXEL_ID || null;
const enabled = () => !!(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN);
// META_GRAPH_BASE is only for local QA against scripts/dev/mock-ai.js.
const GRAPH = `${process.env.META_GRAPH_BASE || "https://graph.facebook.com"}/${process.env.META_GRAPH_VERSION || "v23.0"}`;
const sha = (v) => crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

// Global Privacy Control: browsers send "Sec-GPC: 1" when the person has opted
// out of data sharing. We honour it by not sending their events to Meta.
export const gpc = (req) => req?.get?.("sec-gpc") === "1";

// The page the event happened on. The page sends its own address as `pageUrl`
// (public/js/pixel.js); older tabs don't, so the Referer is the fallback. Only
// an address on this site is used, and only its origin and path: query
// strings can carry one-time tokens (email links) that must not leave the site.
export function sourceUrl(req) {
  const host = req.get("host");
  for (const raw of [req.body?.pageUrl, req.get("referer")]) {
    if (typeof raw !== "string" || raw.length > 2048) continue;
    try {
      const u = new URL(raw);
      if (u.host === host && (u.protocol === "https:" || u.protocol === "http:")) return u.origin + u.pathname;
    } catch {}
  }
  return `${req.protocol}://${host}/`;
}

// The browser details Meta matches a website event on, taken from a request
// so an event sent later without one (a purchase confirmed by Stripe) can
// still carry them. Nothing when tracking is off or the visitor opted out.
export function browserDetails(req) {
  if (!enabled() || !req || gpc(req)) return {};
  const d = { ip: req.ip, ua: req.get("user-agent"), fbp: req.cookies?._fbp, fbc: req.cookies?._fbc };
  // 500 characters is Stripe's limit for a metadata value.
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 500) : ""]).filter(([, v]) => v));
}

// Send one event. `req` is optional (purchases can be confirmed without one);
// without it, `browser` (from browserDetails) supplies the browser details.
export function track(name, { eventId, user, req, browser, value, currency = "USD", url, optOut = false } = {}) {
  if (!enabled() || optOut || gpc(req)) return;
  const user_data = {};
  if (user?.email) user_data.em = [sha(user.email)];
  if (user?.id) user_data.external_id = [sha(user.id)];
  const b = req ? browserDetails(req) : browser || {};
  if (b.ip) user_data.client_ip_address = b.ip;
  if (b.ua) user_data.client_user_agent = b.ua;
  if (b.fbp) user_data.fbp = b.fbp;
  if (b.fbc) user_data.fbc = b.fbc;
  const event = {
    event_name: name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: url || (req ? sourceUrl(req) : "https://keeperheadshots.com/"),
    user_data,
    ...(value != null ? { custom_data: { value, currency } } : {}),
  };
  const body = { data: [event], ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}) };
  background(
    fetch(`${GRAPH}/${process.env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) console.error("[meta]", name, r.status, (await r.text()).slice(0, 300));
    }),
  );
}
