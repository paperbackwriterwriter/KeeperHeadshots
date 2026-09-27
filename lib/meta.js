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

// Send one event. `req` is optional (purchases can be confirmed without one).
export function track(name, { eventId, user, req, value, currency = "USD", url } = {}) {
  if (!enabled()) return;
  const user_data = {};
  if (user?.email) user_data.em = [sha(user.email)];
  if (user?.id) user_data.external_id = [sha(user.id)];
  if (req) {
    user_data.client_ip_address = req.ip;
    user_data.client_user_agent = req.get("user-agent") || undefined;
    if (req.cookies?._fbp) user_data.fbp = req.cookies._fbp;
    if (req.cookies?._fbc) user_data.fbc = req.cookies._fbc;
  }
  const event = {
    event_name: name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: url || (req ? `${req.protocol}://${req.get("host")}${req.get("x-page-path") || "/"}` : "https://keeperheadshots.com/"),
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
