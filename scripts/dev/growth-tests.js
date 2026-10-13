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
  await account("funnel-owner2@example.com"); // an owner signing up isn't a sign-up in the funnel
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
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  ok("funnel report has one row per day, in Central time", after.rows.length === 7 && after.rows[0].date === today, `${after.rows[0].date} vs ${today}`);
  const bad = await owner("/api/owner/offer", { method: "POST", body: JSON.stringify({ code: "NOPE-20", discount: "20% off", until: "Sunday" }) });
  const good = await owner("/api/owner/offer", { method: "POST", body: JSON.stringify({ code: "KEEP20", discount: "20% off", until: "Sunday" }) });
  ok("an offer code is checked with Stripe before anyone is counted or emailed", bad.status === 400 && /no active promotion code/.test(bad.j?.error || "") && good.status === 200 && good.j.promo?.percentOff === 20, `${bad.status} ${bad.j?.error} / ${good.status} ${JSON.stringify(good.j?.promo)}`);
  // A partial refund takes back only the shoots it pays for: less than a
  // shoot's worth takes none, and a refund rounded down to the cent counts.
  {
    const { j: pc } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
    const psid = new URL(pc.url).pathname.split("/").pop();
    await fetch(`${M}/mock-pay/${psid}`, { redirect: "manual" });
    await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: psid }) });
    const credits = async () => (await f("/api/me")).j.user.plan.credits;
    const c0 = await credits();
    // Starter: $29 for 3 shoots, $9.66⅔ each. Each step is the running total
    // refunded and how many shoots it should have taken back by then.
    const steps = [[484, 0], [919, 0], [965, 0], [966, 1], [1932, 1], [1933, 2]];
    const seen = [];
    for (const [amount] of steps) {
      await fetch(`${M}/mock-refund/${psid}?amount=${amount}`);
      await f("/api/billing/sync", { method: "POST", body: "{}" });
      seen.push(c0 - (await credits()));
    }
    ok("a partial refund takes back a shoot only once it covers that shoot, to the cent", steps.every(([, want], i) => seen[i] === want), JSON.stringify(steps.map(([a], i) => [a, seen[i]])));
  }
  // A refund shows in the funnel once, on the day it's made, as an amount and an order.
  const { j: co } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const refundSid = new URL(co.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${refundSid}`, { redirect: "manual" });
  await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: refundSid }) });
  const mid = (await owner("/api/owner/funnel?days=7")).j.totals;
  await fetch(`${M}/mock-refund/${refundSid}`);
  await f("/api/billing/sync", { method: "POST", body: "{}" });
  await f("/api/billing/sync", { method: "POST", body: "{}" }); // a second sync counts nothing more
  const end = (await owner("/api/owner/funnel?days=7")).j.totals;
  ok("a refund is counted once in the funnel", end.refunds - mid.refunds === 2900 && end.refunded - mid.refunded === 1 && end.revenue === mid.revenue, JSON.stringify({ refunds: end.refunds - mid.refunds, refunded: end.refunded - mid.refunded }));
  const stranger = await f("/api/owner/funnel");
  ok("only owners can see the funnel", stranger.status === 404, String(stranger.status));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
