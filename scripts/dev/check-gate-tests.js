// DEV/QA ONLY — the photo check's scores: under RECOMMENDED_CHECK_SCORE a set
// is a retake (with directions), which the person may continue past anyway;
// under MIN_CHECK_SCORE it can't be developed at all. A retake doesn't use up
// a free check.
// Run against a local server wired to scripts/dev/mock-ai.js (there a set of
// exactly 5 photos scores 62 and one of 4 scores 70):
//   node scripts/dev/check-gate-tests.js
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
import { gateCheck, checkBlocks } from "../../lib/ai.js";
import { MIN_CHECK_SCORE, RECOMMENDED_CHECK_SCORE } from "../../public/js/shared/catalog.js";
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
function client() {
  let cookie = "";
  return async (p, o = {}) => {
    const r = await fetch(B + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let j = null;
    try { j = await r.clone().json(); } catch {}
    return { status: r.status, j };
  };
}
const mails = () => fetch(`${M}/mock-mail`).then((r) => r.json());
const verifyToken = async (email) => new URL((await mails()).filter((m) => m.to.includes(email.toLowerCase())).flatMap((m) => m.links).findLast((l) => l.includes("/verify?token="))).searchParams.get("token");
const photo = async (i) => "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("cg" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
const LOOKS = [{ backdrop: "studio-gray", outfit: "navy-suit" }];
const HEADLINE = "New selfies will give you the professional results we're known for.";

// 1. The rules.
ok("the minimum is 65 and the recommended score 76", MIN_CHECK_SCORE === 65 && RECOMMENDED_CHECK_SCORE === 76);
ok("75 is a retake, whatever the verdict said", gateCheck({ overall_score: 75, verdict: "ready", summary: "x", tips: ["t"] }).verdict === "retake");
ok("76 passes", gateCheck({ overall_score: 76, verdict: "usable" }).verdict === "usable");
ok("under 65 blocks; 65 doesn't", checkBlocks({ overall_score: 64 }) && !checkBlocks({ overall_score: 65 }));
{
  const soft = gateCheck({ overall_score: 70, verdict: "usable", headline: "Great set!", summary: "Ready to go.", tips: ["Face a window."], retake_direction: [] });
  ok("a set of 70 says new selfies are recommended", soft.headline === HEADLINE && /70/.test(soft.summary) && /recommend 76/.test(soft.summary) && !/Ready to go/.test(soft.summary), soft.summary);
  ok("with directions (falling back to the tips)", soft.retake_direction.length === 1);
  const hard = gateCheck({ overall_score: 60, verdict: "usable", summary: "Ready to go.", tips: [] });
  ok("a set of 60 says a shoot needs at least 65", /60/.test(hard.summary) && /at least 65/.test(hard.summary), hard.summary);
}
ok("a retake the check made itself is kept as is", gateCheck({ overall_score: 90, verdict: "retake" }).verdict === "retake");

// 2. Through the API.
async function account() {
  const f = client();
  const email = `gate${Date.now()}${Math.random().toString(36).slice(2, 6)}@x.com`;
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Gail Gate", email, password: "password123" }) });
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email) }) });
  return f;
}
async function checked(f, n) {
  const sid = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  for (let i = 0; i < n; i++) await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(i) }) });
  return [sid, await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" })];
}

// Under the minimum (62): blocked, even with override.
{
  const f = await account();
  const before = (await f("/api/me")).j.user.plan.checksLeft;
  const [sid, check] = await checked(f, 5);
  const c = check.j?.shoot?.check;
  ok("a set scoring 62 comes back as a retake", check.status === 200 && c?.overall_score === 62 && c?.verdict === "retake", `${check.status} ${c?.overall_score} ${c?.verdict}`);
  ok("with directions and the retake headline", (c?.retake_direction || []).length > 0 && c?.headline === HEADLINE, c?.headline);
  // The privacy policy: nothing derived from the face is kept. The hair,
  // glasses and expression notes the brief uses are.
  const saved = (await f(`/api/shoots/${sid}`)).j.shoot.check?.subject;
  ok("the check keeps no description of the face", saved && !("description" in saved) && typeof saved.hair === "string", JSON.stringify(saved));
  const after = (await f("/api/me")).j.user.plan.checksLeft;
  ok("the retake didn't use up a free check", after === before, `${before} → ${after}`);
  const gen = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  ok("it can't be developed", gen.status === 400 && gen.j?.code === "retake_needed", `${gen.status} ${gen.j?.code}`);
  const forced = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS, override: true }) });
  ok("not even when continuing anyway", forced.status === 400 && forced.j?.code === "retake_needed", `${forced.status}`);
  // New selfies: one more photo (6 score 84 with the mock), re-check, develop.
  await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(9) }) });
  const re = await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
  ok("after new selfies the set passes", re.j?.shoot?.check?.overall_score === 84 && re.j.shoot.check.verdict === "ready", `${re.status} ${re.j?.shoot?.check?.overall_score}`);
  const left = (await f("/api/me")).j.user.plan.checksLeft;
  ok("a passing check uses one free check as before", left === after - 1, `${after} → ${left}`);
  const go = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  ok("and develops", go.status === 202, `${go.status} ${go.j?.error || ""}`);
}

// Between the two (70): a retake that may be continued past.
{
  const f = await account();
  const [sid, check] = await checked(f, 4);
  const c = check.j?.shoot?.check;
  ok("a set scoring 70 comes back as a retake", c?.overall_score === 70 && c?.verdict === "retake", `${c?.overall_score} ${c?.verdict}`);
  const gen = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  ok("it needs the person's go-ahead", gen.status === 400 && gen.j?.code === "retake_recommended", `${gen.status} ${gen.j?.code}`);
  const before = (await f("/api/me")).j.user.plan.checksLeft;
  const go = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS, override: true }) });
  ok("and develops when they continue anyway", go.status === 202, `${go.status} ${go.j?.error || ""}`);
  let after = before;
  for (let i = 0; i < 20 && after === before; i++) { await new Promise((r) => setTimeout(r, 150)); after = (await f("/api/me")).j.user.plan.checksLeft; }
  ok("going ahead counts the check that was given back", after === before - 1, `${before} → ${after}`);
}

// The background worker refuses a malformed signature instead of crashing.
{
  const { workerJob } = await import("../../lib/shoot-jobs.js");
  process.env.SESSION_SECRET ||= "test-secret-test-secret-test-secret";
  let threw = false, out;
  try { out = workerJob({ sid: "sht_abcdefgh", jobId: "job_abcdefgh", exp: Date.now() + 60_000, sig: "é".repeat(43) }); } catch { threw = true; }
  ok("a non-ASCII worker signature is refused, not a crash", !threw && out === null);
}

// Before the free shoot, using up the free checks doesn't leave anyone stuck:
// more checks come from a daily allowance per mailbox (FREE.checksPerDayBeforeShoot),
// until the free shoot is used.
{
  const { FREE } = await import("../../lib/plan.js");
  const t = Date.now();
  const base = `before-shoot${t}`;
  const f = client();
  const email = `${base}@gmail.com`;
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Lisa Check", email, password: "password123" }) });
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email) }) });
  const sid = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(90) }) });
  const statuses = [];
  for (let i = 0; i < FREE.checks + FREE.checksPerDayBeforeShoot + 1; i++) statuses.push((await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" })).status);
  const last = await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
  const free = statuses.slice(0, FREE.checks), extra = statuses.slice(FREE.checks, FREE.checks + FREE.checksPerDayBeforeShoot);
  ok(`after the ${FREE.checks} free checks, the free shoot not yet used: ${FREE.checksPerDayBeforeShoot} more today`, free.every((x) => x === 200) && extra.every((x) => x === 200), statuses.join(","));
  ok("then a daily limit, with a way forward", statuses.at(-1) === 429 && last.status === 429 && /tomorrow/.test(last.j?.error || "") && /free shoot/.test(last.j?.error || ""), `${statuses.at(-1)} ${last.j?.error}`);
  ok("the free allowance itself isn't overdrawn", (await f("/api/me")).j.user.plan.checksLeft === 0);
  const alias = client();
  const aliasEmail = `${base}+alias@gmail.com`;
  await alias("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Lisa Alias", email: aliasEmail, password: "password123" }) });
  await alias("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(aliasEmail) }) });
  const asid = (await alias("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await alias(`/api/shoots/${asid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(91) }) });
  const shared = await alias(`/api/shoots/${asid}/check`, { method: "POST", body: "{}" });
  ok("the daily allowance is shared by every address for the mailbox", shared.status === 429, `${shared.status}`);
  // Unusual spellings of the same inbox share it too.
  const quoted = client();
  const quotedEmail = `"${base}"@gmail.com`;
  await quoted("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Lisa Quoted", email: quotedEmail, password: "password123" }) });
  await quoted("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(quotedEmail) }) });
  const qsid = (await quoted("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await quoted(`/api/shoots/${qsid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(93) }) });
  const q = await quoted(`/api/shoots/${qsid}/check`, { method: "POST", body: "{}" });
  const { canonicalEmail } = await import("../../lib/store.js");
  ok("a quoted address or a trailing dot is the same mailbox", q.status === 429 && [`${base}@gmail.com.`, `"${base}"+x@gmail.com`].every((e) => canonicalEmail(e) === canonicalEmail(`${base}@gmail.com`)), `${q.status}`);
  // Once the free shoot is used, the free allowance is the limit again.
  // (A second draft first: with no shoots left, a new one can't be started.)
  const sid2 = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await f(`/api/shoots/${sid2}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(92) }) });
  const dev = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  const after = await f(`/api/shoots/${sid2}/check`, { method: "POST", body: "{}" });
  ok("once the free shoot is used, the free checks are the limit again", dev.status === 202 && after.status === 402 && /Buy a package/.test(after.j?.error || ""), `${dev.status} ${after.status} ${after.j?.error}`);
}

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
