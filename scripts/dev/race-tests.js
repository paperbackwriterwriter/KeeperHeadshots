// DEV/QA ONLY — regression tests for races and abuse cases (double spends,
// email aliases, sign-in lockout, open redirects). Run against a local server
// wired to scripts/dev/mock-ai.js with RESEND_API_KEY=test
// RESEND_BASE_URL=http://localhost:4010:  node scripts/dev/race-tests.js
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
const B = "http://localhost:3100", M = "http://localhost:4010";
const results = [];
const ok = (name, cond, extra = "") => (results.push([name, !!cond]), console.log(cond ? "PASS" : "FAIL", name, extra));
function client() {
  let cookie = "";
  return async (p, o = {}) => {
    const r = await fetch(B + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j, loc: r.headers.get("location") };
  };
}
async function account(email) {
  const f = client();
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "QA Person", email, password: "password123" }) });
  const mail = await fetch(`${M}/mock-mail`).then((r) => r.json());
  const link = mail.filter((m) => m.to.includes(email.toLowerCase())).flatMap((m) => m.links).find((l) => l.includes("/verify?token="));
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: new URL(link).searchParams.get("token") }) });
  return f;
}
const photo = "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("q", { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
async function checkedShoot(f) {
  const { j } = await f("/api/shoots", { method: "POST", body: "{}" });
  await f(`/api/shoots/${j.shoot.id}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  await f(`/api/shoots/${j.shoot.id}/check`, { method: "POST" });
  return j.shoot.id;
}
const looks = JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }] });

// 1. One free shoot, two shoots developed at once: only one may start.
const a = await account(`racer${Date.now()}@x.com`);
const [s1, s2] = [await checkedShoot(a), await checkedShoot(a)];
const [g1, g2] = await Promise.all([a(`/api/shoots/${s1}/generate`, { method: "POST", body: looks }), a(`/api/shoots/${s2}/generate`, { method: "POST", body: looks })]);
ok("free shoot can't be spent twice in parallel", [g1.status, g2.status].sort().join() === "202,402", `${g1.status},${g2.status}`);
// 2. Same shoot, two clicks: one starts, one 409.
const b = await account(`clicker${Date.now()}@x.com`);
const s3 = await checkedShoot(b);
const [h1, h2] = await Promise.all([b(`/api/shoots/${s3}/generate`, { method: "POST", body: looks }), b(`/api/shoots/${s3}/generate`, { method: "POST", body: looks })]);
ok("double-click develops once", [h1.status, h2.status].sort().join() === "202,409", `${h1.status},${h2.status}`);
// 3. Gmail alias can't claim a second free shoot.
const t = Date.now();
const c1 = await account(`jo.smith${t}@gmail.com`);
const c2 = await account(`josmith${t}+ads@gmail.com`);
const r1 = await c1(`/api/shoots/${await checkedShoot(c1)}/generate`, { method: "POST", body: looks });
const r2 = await c2(`/api/shoots/${await checkedShoot(c2)}/generate`, { method: "POST", body: looks });
ok("email alias can't reuse the free shoot", r1.status === 202 && r2.status === 402 && r2.j?.code === "free_used", `${r1.status},${r2.status} ${r2.j?.code}`);
// 4. Malformed looks -> 400, bad ids -> 404.
const bad = await b(`/api/shoots/${s3}/generate`, { method: "POST", body: JSON.stringify({ looks: "x" }) });
ok("malformed looks rejected cleanly (no 500)", bad.status < 500, String(bad.status));
const badId = await b(`/api/shoots/..%2Fpayments%2Fx`);
ok("invalid shoot id -> 404", badId.status === 404, String(badId.status));
// 5. Sign-in lockout and wrong-password deletion.
const em = `lock${Date.now()}@x.com`; await account(em);
const f = client();
for (let i = 0; i < 10; i++) await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: em, password: "wrong-password" }) });
const locked = await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: em, password: "password123" }) });
ok("sign-in locks after 10 wrong passwords", locked.status === 429, String(locked.status));
const t0 = performance.now(); await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: `nobody${Date.now()}@x.com`, password: "whatever123" }) }); const tMissing = performance.now() - t0;
ok("unknown email still runs the password hash (timing)", tMissing > 15, `${tMissing.toFixed(0)}ms`);
const del = await b("/api/account/delete", { method: "POST", body: JSON.stringify({ password: "not-my-password" }) });
ok("account deletion rejects a wrong password", del.status === 401, String(del.status));
// 6. Open redirect and trailing slash.
for (const p of ["//evil.com/", "/%5Cevil.com/", "//evil.com/x/?a=1"]) { const r = await fetch(B + p, { redirect: "manual" }); const loc = r.headers.get("location") || ""; ok(`no open redirect for ${p}`, !/^\/\/|^\/\\|^https?:/i.test(loc), `${r.status} ${loc}`); }
const slash = await fetch(B + "/linkedin-headshots/", { redirect: "manual" });
ok("trailing slash still redirects on-site", slash.status === 301 && slash.headers.get("location") === "/linkedin-headshots", `${slash.status} ${slash.headers.get("location")}`);
// 7. Signup name with a link rejected.
const n = await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Win http://evil.com", email: `n${Date.now()}@x.com`, password: "password123" }) });
ok("signup name with URL rejected", n.status === 400, String(n.status));
// 8. Parallel checks can't exceed the free allowance (6), once the free shoot
// is used (before it, see the daily allowance below).
const d = await account(`checks${Date.now()}@x.com`);
const s4 = await checkedShoot(d); // 1 used
const s5 = await checkedShoot(d); // 2 used (made first: afterwards there are no shoots left to start)
await d(`/api/shoots/${s4}/generate`, { method: "POST", body: looks });
const outs = await Promise.all(Array.from({ length: 8 }, () => d(`/api/shoots/${s5}/check`, { method: "POST" })));
const used = 2 + outs.filter((o) => o.status === 200).length;
ok("parallel photo checks capped at 6", used <= 6, `used ${used}`);
// 9. Before the free shoot, parallel checks past the 6 can't exceed the daily
// allowance (10) either, across the last free check and the daily ones.
{
  const e = await account(`checks-day${Date.now()}@x.com`);
  const s = await checkedShoot(e); // 1 used
  for (let i = 0; i < 4; i++) await e(`/api/shoots/${s}/check`, { method: "POST" }); // 5 used
  const runs = await Promise.all(Array.from({ length: 16 }, () => e(`/api/shoots/${s}/check`, { method: "POST" })));
  const passed = runs.filter((o) => o.status === 200).length;
  ok("parallel checks before the free shoot: at most 1 free + 10 that day", passed <= 11, `passed ${passed}`);
}
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
