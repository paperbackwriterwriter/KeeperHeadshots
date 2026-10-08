// DEV/QA ONLY — a local stand-in for the Anthropic and Gemini HTTP APIs so the
// full pipeline (SDK calls, parsing, polling, UI states) can be exercised in an
// environment without API keys. The app never uses this unless you point
// ANTHROPIC_BASE_URL / GEMINI_BASE_URL at it explicitly:
//
//   node scripts/dev/mock-ai.js &              # listens on :4010
//   ANTHROPIC_API_KEY=test GEMINI_API_KEY=test \
//   ANTHROPIC_BASE_URL=http://localhost:4010 GEMINI_BASE_URL=http://localhost:4010 npm start
//
// Set MOCK_FAIL_EVERY=3 to make every third image render fail (error states).
//
// Also a tiny SMTP sink on :2525 (SMTP_HOST=localhost SMTP_PORT=2525
// SMTP_PASS=x) that keeps every message, and a Resend API stand-in
// (RESEND_API_KEY=test RESEND_BASE_URL=http://localhost:4010) that keeps them
// in the same list; GET /mock-mail lists them.

import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
import { BACKDROPS, OUTFITS } from "../../public/js/shared/catalog.js";

const PORT = Number(process.env.MOCK_PORT || 4010);
const FAIL_EVERY = Number(process.env.MOCK_FAIL_EVERY || 0);
const DELAY = Number(process.env.MOCK_DELAY_MS || 1800);
let imageCount = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readBody = (req) => new Promise((res) => {
  let d = "";
  req.on("data", (c) => (d += c));
  req.on("end", () => res(d));
});

function checkResult(nImages) {
  return {
    overall_score: 84,
    verdict: "ready",
    headline: "A clear, well-lit set — ready for the studio.",
    summary: "Your face is sharp and evenly lit across the set, and the mix of angles gives the model plenty to work with. The first photo is your strongest reference.",
    subject: { description: "Short dark hair; no glasses; no facial hair.", glasses: false },
    photos: Array.from({ length: nImages }, (_, i) => ({
      index: i,
      score: [91, 82, 76, 64, 88, 70][i % 6],
      keep: i % 6 !== 3,
      lighting: [9, 8, 7, 5, 9, 7][i % 6],
      sharpness: [9, 8, 8, 6, 9, 7][i % 6],
      face_visibility: [10, 9, 8, 7, 9, 8][i % 6],
      expression: [8, 8, 7, 6, 9, 7][i % 6],
      issues: [[], [], ["Slight color cast"], ["Low light", "Face small in frame"], [], ["Busy background"]][i % 6],
      note: ["Soft, even light and a relaxed expression — ideal.", "Good angle with crisp detail.", "A little warm, but features are clear.", "Too dim to trust for fine detail.", "Lovely natural smile.", "Usable, though the background is busy."][i % 6],
    })),
    tips: ["Add one photo taken facing a window for even light.", "Include a slight three-quarter turn."],
  };
}

function reviewResult(nShots) {
  const grades = ["keeper", "keeper", "solid", "keeper", "retake", "solid", "keeper", "solid"];
  const uses = ["LinkedIn", "Company site", "Speaker bio", "Personal site", "—", "Slack avatar", "Author photo", "Newsletter"];
  return {
    headline: "Strong set — your first look leads.",
    summary: "Likeness held across nearly every frame. Use the top-scoring portrait for LinkedIn and the warmer looks where you want to feel more approachable.",
    shots: Array.from({ length: nShots }, (_, i) => {
      const g = grades[i % grades.length];
      const overall = g === "keeper" ? 94 - i : g === "solid" ? 76 - i : 55;
      return { likeness: g === "retake" ? 5 : 9 - (i % 2), polish: g === "retake" ? 6 : 8 + (i % 2), lighting: 8, overall, grade: g, best_for: uses[i % uses.length], note: g === "retake" ? "Ear shape drifts from your references — skip this one." : "Clean light and a natural expression." };
    }),
  };
}

// Quality gate: fails every third check (every check with MOCK_QA_FAIL=all,
// none with MOCK_QA_FAIL=none) so the retake path gets exercised. MOCK_QA_TIGHT=1 reports tight headroom on
// some passing frames, which exercises the widened-square path.
let qaCalls = 0;
function qaResult() {
  qaCalls++;
  const mode = process.env.MOCK_QA_FAIL;
  const fail = mode === "all" || (mode !== "none" && qaCalls % 3 === 1);
  return fail
    ? { likeness: 6, likeness_notes: "The jaw reads narrower than in the references.", professional: 7, issues: [{ kind: "likeness", severity: "blocking", detail: "Jaw narrower than in the references" }], head_box: { top: 0.02, bottom: 0.5, left: 0.3, right: 0.7 }, pass: false, retake_direction: "Keep the jaw as wide as in the references." }
    : { likeness: 9, likeness_notes: "Face shape, eyes and hairline match the references.", professional: 9, issues: [], head_box: process.env.MOCK_QA_TIGHT && qaCalls % 2 === 0 ? { top: 0.02, bottom: 0.45, left: 0.3, right: 0.7 } : { top: 0.14, bottom: 0.52, left: 0.33, right: 0.67 }, pass: true, retake_direction: "" };
}

async function anthropic(req, res, body) {
  const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system);
  const content = body.messages?.[0]?.content || [];
  const images = content.filter((c) => c.type === "image").length;
  console.log(`[mock] POST /v1/messages model=${body.model} images=${images} beta=${req.headers["anthropic-beta"]} fallbacks=${JSON.stringify(body.fallbacks)} format=${body.output_config?.format?.type}`);
  await sleep(DELAY);
  let out;
  if (system.includes("photo-intake")) out = checkResult(images);
  else if (system.includes("final quality gate")) out = qaResult();
  else {
    const frames = content.filter((c) => c.type === "text" && /^Frame \d+/.test(c.text)).map((c) => Number(/^Frame (\d+)/.exec(c.text)[1]));
    out = reviewResult(frames.length);
    out.shots.forEach((sh, i) => (sh.frame = frames[i]));
    out.best_frame = frames[0];
  }
  res.writeHead(200, { "content-type": "application/json", "request-id": "req_mock" });
  res.end(JSON.stringify({
    id: "msg_mock", type: "message", role: "assistant", model: body.model,
    content: [{ type: "text", text: JSON.stringify(out) }],
    stop_reason: "end_turn", stop_sequence: null, stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 400 },
  }));
}

// Image calls in flight right now, logged with each call so QA scripts can
// see how many ran at once (scripts/dev/render-race.js): all of them
// (inflight), and frame renders only (renders: calls with the person's
// photos as references, not the one-image widening of a finished frame's
// square, which runs after the frame is delivered).
let inflight = 0;
let rendersInflight = 0;
async function gemini(req, res, body, url) {
  const render = (body.contents?.[0]?.parts?.filter((p) => p.inlineData).length || 0) >= 2;
  inflight++;
  if (render) rendersInflight++;
  try {
    return await geminiCall(req, res, body, url);
  } finally {
    inflight--;
    if (render) rendersInflight--;
  }
}

async function geminiCall(req, res, body, url) {
  imageCount++;
  const prompt = body.contents?.[0]?.parts?.find((p) => p.text)?.text || "";
  const refs = body.contents?.[0]?.parts?.filter((p) => p.inlineData).length;
  console.log(`[mock] ${url} refs=${refs} #${imageCount} inflight=${inflight} renders=${rendersInflight}`);
  await sleep(DELAY + Math.random() * 2500);
  if (FAIL_EVERY && imageCount % FAIL_EVERY === 0) {
    res.writeHead(500, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { code: 500, message: "Mock render failure", status: "INTERNAL" } }));
  }
  const backdrop = BACKDROPS.find((b) => prompt.includes(b.prompt.slice(0, 40)))?.id;
  const outfit = OUTFITS.find((o) => prompt.includes(o.prompt.slice(0, 30)))?.id;
  const jpg = await sharp(Buffer.from(portraitSVG("mock" + imageCount, { backdrop, outfit, skin: 2, hair: "short", hairTone: 2 }))).resize(768, 1024).jpeg({ quality: 88 }).toBuffer();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "image/jpeg", data: jpg.toString("base64") } }] }, finishReason: "STOP" }] }));
}

// Minimal Stripe API stand-in: customers, Checkout Sessions, and a fake
// hosted payment page at /mock-pay/:id that marks the session paid.
const stripeSessions = new Map();
let stripeSeq = 0;
// Meta Conversions API stand-in: logs each event it receives.
const metaEvents = [];
function meta(req, res, raw) {
  const body = JSON.parse(raw || "{}");
  for (const e of body.data || []) metaEvents.push(e), console.log(`[mock] meta ${e.event_name} id=${e.event_id} value=${e.custom_data?.value ?? "-"} em=${e.user_data?.em ? "hashed" : "none"} url=${e.event_source_url}`);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ events_received: (body.data || []).length }));
}

function stripe(req, res, raw) {
  const url = new URL(req.url, "http://x");
  const form = Object.fromEntries(new URLSearchParams(raw || ""));
  const json = (o, code = 200) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(o)));
  if (req.method === "POST" && url.pathname === "/v1/customers") return json({ id: `cus_mock${++stripeSeq}`, object: "customer", email: form.email });
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const id = `cs_mock_${++stripeSeq}`;
    const s = {
      id, object: "checkout.session", customer: form.customer, client_reference_id: form.client_reference_id, payment_status: "unpaid",
      amount_total: Number(form["line_items[0][price_data][unit_amount]"]), currency: "usd",
      metadata: Object.fromEntries(Object.entries(form).filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v])),
      success_url: form.success_url || form.return_url, cancel_url: form.cancel_url, ui_mode: form.ui_mode || "hosted_page",
      status: "open", allow_promotion_codes: form.allow_promotion_codes === "true", total_details: { amount_discount: 0 },
      // Embedded sessions have a client secret instead of a hosted-page URL.
      ...(form.ui_mode === "embedded_page" ? { url: null, client_secret: `${id}_secret_mock`, return_url: form.return_url } : { url: `http://localhost:${PORT}/mock-pay/${id}` }),
    };
    stripeSessions.set(id, s);
    console.log(`[mock] stripe session ${id} ${s.metadata.packageId} $${s.amount_total / 100}`);
    return json(s);
  }
  const m = /^\/v1\/checkout\/sessions\/([\w-]+)$/.exec(url.pathname);
  if (req.method === "GET" && m) return stripeSessions.has(m[1]) ? json(stripeSessions.get(m[1])) : json({ error: { type: "invalid_request_error", message: "No such session" } }, 404);
  if (req.method === "GET" && url.pathname === "/v1/checkout/sessions") {
    // Sessions carry their charge (as with expand[]=data.payment_intent.latest_charge) so refunds can be reconciled.
    const data = [...stripeSessions.values()]
      .filter((s) => s.customer === url.searchParams.get("customer"))
      .map((s) => ({ ...s, payment_intent: s.payment_status === "paid" ? { id: `pi_${s.id}`, latest_charge: { id: `ch_${s.id}`, amount: s.amount_total, amount_refunded: s.refunded || 0, refunded: (s.refunded || 0) >= s.amount_total } } : null }));
    return json({ object: "list", data, has_more: false, url: "/v1/checkout/sessions" });
  }
  // QA helper: /mock-refund/<session>?amount=<cents> (defaults to a full refund).
  const refund = /^\/mock-refund\/([\w-]+)$/.exec(url.pathname);
  if (refund && stripeSessions.has(refund[1])) {
    const s = stripeSessions.get(refund[1]);
    s.refunded = Math.min(s.amount_total, Number(url.searchParams.get("amount") || s.amount_total));
    return json({ refunded: s.refunded });
  }
  const pay = /^\/mock-pay\/([\w-]+)$/.exec(url.pathname);
  if (pay && stripeSessions.has(pay[1])) {
    const s = stripeSessions.get(pay[1]);
    const cancel = url.searchParams.get("cancel");
    // ?promo=FREE (100% off: nothing to pay) or ?promo=HALF, like a promotion
    // code entered on Stripe's page (only when the session allows codes).
    const promo = s.allow_promotion_codes ? url.searchParams.get("promo") : null;
    if (promo === "FREE" || promo === "HALF") {
      const off = promo === "FREE" ? s.amount_total : Math.round(s.amount_total / 2);
      s.total_details = { amount_discount: off };
      s.amount_total -= off;
    }
    if (!cancel) Object.assign(s, { status: "complete", payment_status: s.amount_total === 0 ? "no_payment_required" : "paid" });
    res.writeHead(302, { location: cancel ? s.cancel_url : s.success_url.replace("{CHECKOUT_SESSION_ID}", s.id) });
    return res.end();
  }
  return json({ error: { type: "invalid_request_error", message: "mock: not found" } }, 404);
}

http
  .createServer(async (req, res) => {
    const raw = await readBody(req);
    if (req.url.startsWith("/v1/customers") || req.url.startsWith("/v1/checkout") || req.url.startsWith("/mock-pay") || req.url.startsWith("/mock-refund")) return stripe(req, res, raw);
    if (/^\/v\d+\.\d+\/\d+\/events/.test(req.url)) return meta(req, res, raw);
    // Google's token endpoint. The test makes up the "code": base64url JSON
    // with the claims it wants in the ID token, plus the PKCE challenge from
    // the sign-in URL, which the verifier sent here must match.
    if (req.url === "/google/token" && req.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(raw));
      const send = (code, body) => (res.writeHead(code, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
      let c;
      try {
        c = JSON.parse(Buffer.from(form.code || "", "base64url").toString());
      } catch {
        return send(400, { error: "invalid_grant" });
      }
      const challenge = crypto.createHash("sha256").update(form.code_verifier || "").digest("base64url");
      if (form.grant_type !== "authorization_code" || !form.client_secret || challenge !== c.challenge || !form.redirect_uri?.endsWith("/api/auth/google/callback")) return send(400, { error: "invalid_grant" });
      const { challenge: _, ...claims } = c;
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const id_token = `${enc({ alg: "RS256" })}.${enc({ iss: "https://accounts.google.com", aud: form.client_id, exp: Math.floor(Date.now() / 1000) + 3600, email_verified: true, ...claims })}.sig`;
      console.log(`[mock] google token for ${claims.email}`);
      return send(200, { access_token: "ya29.mock", id_token, token_type: "Bearer", expires_in: 3599 });
    }
    if (req.url === "/turnstile/v0/siteverify") {
      const t = JSON.parse(raw || "{}");
      const ok = t.response && t.response !== "fail-token";
      console.log(`[mock] turnstile ${ok ? "pass" : "fail"}`);
      return res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(ok ? { success: true, action: "signup", hostname: "localhost" } : { success: false, "error-codes": ["invalid-input-response"] }));
    }
    if (req.url === "/emails" && req.method === "POST") {
      const m = JSON.parse(raw || "{}");
      if (!/^Bearer \S+/.test(req.headers.authorization || "")) return res.writeHead(401, { "content-type": "application/json" }), res.end(JSON.stringify({ statusCode: 401, name: "missing_api_key", message: "Missing API key" }));
      if (!m.from || !m.to?.length || !m.subject) return res.writeHead(422, { "content-type": "application/json" }), res.end(JSON.stringify({ statusCode: 422, name: "validation_error", message: "Missing from, to or subject" }));
      const id = `mock_${Date.now().toString(36)}`;
      const to = m.to.map((a) => /<([^>]+)>/.exec(a)?.[1] || a);
      const links = [...new Set(`${m.text || ""} ${m.html || ""}`.match(/https?:\/\/[^\s"<>]+/g) || [])].map((l) => l.replace(/&amp;/g, "&"));
      mail.push({ from: m.from, to, replyTo: m.reply_to, subject: m.subject, links, headers: m.headers, via: "resend", id });
      console.log(`[mock] resend to=${to.join(",")} subject="${m.subject}"`);
      return res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify({ id }));
    }
    // Image calls in flight right now (render-race waits for 0 before it measures).
    if (req.url === "/mock-inflight") return res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify({ inflight, renders: rendersInflight }));
    if (req.url === "/mock-meta") return res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(metaEvents));
    if (req.url === "/mock-mail") return res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(mail));
    const body = raw ? JSON.parse(raw) : {};
    try {
      if (req.url.startsWith("/v1/messages")) return await anthropic(req, res, body);
      if (req.url.includes(":generateContent")) return await gemini(req, res, body, req.url);
      res.writeHead(404).end();
    } catch (err) {
      console.error(err);
      res.writeHead(500).end(JSON.stringify({ error: { message: err.message } }));
    }
  })
  .listen(PORT, () => console.log(`[mock] AI test double on http://localhost:${PORT}`));

// SMTP sink: accepts any login and stores each message (decoded enough to read
// links out of quoted-printable bodies).
const mail = [];
const qp = (s) => s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
net
  .createServer((sock) => {
    let buf = "", data = false, msg = { to: [] };
    const say = (l) => sock.write(l + "\r\n");
    say("220 mock-smtp ready");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        if (data) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const rawMsg = buf.slice(0, end).replace(/\r\n\.\./g, "\r\n.");
          buf = buf.slice(end + 5);
          data = false;
          const decoded = qp(rawMsg);
          const subject = /^Subject: (.*)$/m.exec(rawMsg)?.[1] || "";
          const links = [...new Set(decoded.match(/https?:\/\/[^\s"<>]+/g) || [])];
          mail.push({ ...msg, subject, links, raw: rawMsg });
          console.log(`[mock] mail to=${msg.to.join(",")} subject="${subject}"`);
          msg = { to: [] };
          say("250 queued");
          continue;
        }
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") say("250-mock-smtp"), say("250 AUTH PLAIN");
        else if (cmd === "HELO") say("250 mock-smtp");
        else if (cmd === "AUTH") say("235 ok");
        else if (cmd === "MAIL") (msg.from = /<(.*)>/.exec(line)?.[1]), say("250 ok");
        else if (cmd === "RCPT") msg.to.push(/<(.*)>/.exec(line)?.[1]), say("250 ok");
        else if (cmd === "DATA") (data = true), say("354 go ahead");
        else if (cmd === "QUIT") say("221 bye"), sock.end();
        else say("250 ok");
      }
    });
    sock.on("error", () => {});
  })
  .listen(Number(process.env.MOCK_SMTP_PORT || 2525), () => console.log("[mock] SMTP sink on :2525"));
