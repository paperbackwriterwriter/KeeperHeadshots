// DEV/QA ONLY — the photo check's minimum score (MIN_CHECK_SCORE): a set
// scoring under it is a retake, can't be developed (no "continue anyway"), and
// the retake doesn't use up a free check.
// Run against a local server wired to scripts/dev/mock-ai.js (a set of exactly
// 5 photos scores 62 there):  node scripts/dev/check-gate-tests.js
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
import { gateCheck } from "../../lib/ai.js";
import { MIN_CHECK_SCORE } from "../../public/js/shared/catalog.js";
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

// 1. The rule itself.
ok("the minimum is 76", MIN_CHECK_SCORE === 76);
ok("75 is a retake, whatever the verdict said", gateCheck({ overall_score: 75, verdict: "ready", summary: "x", tips: ["t"] }).verdict === "retake");
ok("76 passes", gateCheck({ overall_score: 76, verdict: "usable" }).verdict === "usable");
{
  const c = gateCheck({ overall_score: 60, verdict: "usable", headline: "Great set!", summary: "Ready to go.", tips: ["Face a window."], retake_direction: [] });
  ok("a gated set says why, not 'ready'", /60/.test(c.summary) && /76/.test(c.summary) && !/Ready to go/.test(c.summary) && c.headline === "New selfies will give you the professional results we're known for.");
  ok("and has directions (falling back to the tips)", c.retake_direction.length === 1);
}
ok("a retake the check made itself is kept as is", gateCheck({ overall_score: 90, verdict: "retake" }).verdict === "retake");

// 2. Through the API.
const f = client();
const email = `gate${Date.now()}@x.com`;
await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Gail Gate", email, password: "password123" }) });
await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email) }) });
const sid = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
for (let i = 0; i < 5; i++) await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(i) }) });
const before = (await f("/api/me")).j.user.plan.checksLeft;
const check = await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
const c = check.j?.shoot?.check;
ok("a set scoring 62 comes back as a retake", check.status === 200 && c?.overall_score === 62 && c?.verdict === "retake", `${check.status} ${c?.overall_score} ${c?.verdict}`);
ok("with directions for new selfies", (c?.retake_direction || []).length > 0);
ok("and the retake headline", c?.headline === "New selfies will give you the professional results we're known for.", c?.headline);
const after = (await f("/api/me")).j.user.plan.checksLeft;
ok("the retake didn't use up a free check", after === before, `${before} → ${after}`);
const gen = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
ok("it can't be developed", gen.status === 400 && gen.j?.code === "retake_needed", `${gen.status} ${gen.j?.code}`);
const forced = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS, override: true }) });
ok("not even with override", forced.status === 400 && forced.j?.code === "retake_needed", `${forced.status}`);

// New selfies: remove one (4 photos score 84 with the mock), re-check, develop.
const shoot = (await f(`/api/shoots/${sid}`)).j.shoot;
const rm = await f(`/api/shoots/${sid}/selfies/${encodeURIComponent(shoot.selfies[4].file.split("/").pop())}`, { method: "DELETE" });
const re = await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
ok("after new selfies the set passes", [200, 204].includes(rm.status) && re.j?.shoot?.check?.overall_score === 84 && re.j.shoot.check.verdict === "ready", `${rm.status} ${re.status} ${re.j?.shoot?.check?.overall_score}`);
const left = (await f("/api/me")).j.user.plan.checksLeft;
ok("a passing check uses one free check as before", left === after - 1, `${after} → ${left}`);
const go = await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
ok("and develops", go.status === 202, `${go.status} ${go.j?.error || ""}`);

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
