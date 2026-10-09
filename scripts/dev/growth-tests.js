// DEV/QA ONLY — promotion codes at checkout and the owner's sales funnel.
// Run against a local server wired to scripts/dev/mock-ai.js, with
// FUNNEL_OWNER (default funnel-owner@example.com) in the server's OWNER_EMAILS:
//   node scripts/dev/growth-tests.js
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const OWNER = process.env.FUNNEL_OWNER || "funnel-owner@example.com";
const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
function client() {
  let cookie = "";
  return async (p, o = {}) => {
    const r = await fetch(B + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let j = null;
    try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
}
const verifyToken = async (email) => new URL((await fetch(`${M}/mock-mail`).then((r) => r.json())).filter((m) => m.to.includes(email.toLowerCase())).flatMap((m) => m.links).find((l) => l.includes("/verify?token="))).searchParams.get("token");
async function account(email, { verify = true } = {}) {
  const f = client();
  const up = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Growth Test", email, password: "password123" }) });
  if (up.status !== 201) await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
  else if (verify) await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email) }) });
  return f;
}
// Pays on the stand-in Stripe page, optionally with a promotion code, then
// confirms the way the dashboard does on return.
async function buy(f, packageId, promo) {
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId }) });
  const id = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${id}${promo ? `?promo=${promo}` : ""}`, { redirect: "manual" });
  return { id, ...(await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: id }) })).j };
}
const t = Date.now();

// 1. Checkout sessions accept promotion codes.
{
  const f = await account(`promo${t}@x.com`);
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const s = await fetch(`${M}/v1/checkout/sessions/${new URL(j.url).pathname.split("/").pop()}`).then((r) => r.json());
  ok("checkout allows promotion codes", s.allow_promotion_codes === true);
}

// 2. A 100%-off code still grants the shoots, with no ad Purchase event.
{
  const f = await account(`free${t}@x.com`);
  const r = await buy(f, "starter", "FREE");
  ok("100%-off code grants the package", r.added === 3 && r.paid === true && !r.eventId && r.user?.plan?.credits === 3, JSON.stringify({ added: r.added, paid: r.paid, eventId: r.eventId || null, credits: r.user?.plan?.credits }));
}

// 3. A partial discount: shoots granted, Purchase value is what was paid.
{
  const f = await account(`half${t}@x.com`);
  const r = await buy(f, "professional", "HALF");
  ok("discounted order reports the amount paid", r.added === 6 && r.value === 19.5 && !!r.eventId, `added=${r.added} value=${r.value}`);
}

// 4. The funnel counts each step once per person, and only owners can see it.
{
  const owner = await account(OWNER);
  const before = (await owner("/api/owner/funnel?days=7")).j;
  const email = `funnel${t}@x.com`;
  const f = await account(email);
  const photo = "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("g", { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
  const { j } = await f("/api/shoots", { method: "POST", body: "{}" });
  await f(`/api/shoots/${j.shoot.id}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  await f(`/api/shoots/${j.shoot.id}/check`, { method: "POST", body: "{}" });
  await f(`/api/shoots/${j.shoot.id}/check`, { method: "POST", body: "{}" }); // a second check isn't a second person
  const dev = await f(`/api/shoots/${j.shoot.id}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }] }) });
  await buy(f, "starter", "FREE"); // a 100%-off order isn't a sale
  await buy(f, "professional");
  await buy(f, "starter", "HALF");
  await new Promise((r) => setTimeout(r, 800)); // steps are recorded just after each response
  const after = (await owner("/api/owner/funnel?days=7")).j;
  const d = (k) => after.totals[k] - before.totals[k];
  const deltas = { signup: d("signup"), verified: d("verified"), checked: d("checked"), developed: d("developed"), buyer: d("buyer"), purchases: d("purchases"), revenue: d("revenue") };
  ok("funnel counts each step once per person, and free orders aren't sales", dev.status === 202 && deltas.signup === 1 && deltas.verified === 1 && deltas.checked === 1 && deltas.developed === 1 && deltas.buyer === 1 && deltas.purchases === 2 && deltas.revenue === 3900 + 1450, JSON.stringify(deltas));
  ok("funnel report has one row per day", after.rows.length === 7 && after.rows[0].date === new Date().toISOString().slice(0, 10));
  const stranger = await f("/api/owner/funnel");
  ok("only owners can see the funnel", stranger.status === 404, String(stranger.status));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
