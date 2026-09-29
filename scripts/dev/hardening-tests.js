// DEV/QA ONLY — regression tests for the second and third QA passes: verify links never
// sign anyone in, parallel sign-in guesses all count, atomic photo edits and
// checks, the reset request never reveals accounts, admin token only in a
// header, checkout rate limit, one account per email under a race. Run against
// a local server wired to scripts/dev/mock-ai.js (see race-tests.js):
//   node scripts/dev/hardening-tests.js
import fs from "node:fs";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
const B = process.env.BASE || "http://localhost:3100", M = "http://localhost:4010";
const results = [];
const ok = (name, cond, extra = "") => (results.push([name, !!cond]), console.log(cond ? "PASS" : "FAIL", name, extra));
function client() {
  let cookie = "";
  const f = async (p, o = {}) => {
    const r = await fetch(B + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let j = null;
    try { j = await r.json(); } catch {}
    return { status: r.status, j, setCookie: !!sc };
  };
  return f;
}
const mailFor = async (email) => (await fetch(`${M}/mock-mail`).then((r) => r.json())).filter((m) => m.to.includes(email.toLowerCase()));
const verifyToken = async (email) => new URL((await mailFor(email)).flatMap((m) => m.links).find((l) => l.includes("/verify?token="))).searchParams.get("token");
async function account(email) {
  const f = client();
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "QA Person", email, password: "password123" }) });
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email) }) });
  return f;
}
const photo = "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("h", { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
const t = Date.now();

// 1. A confirmation link confirms the address but never signs the opener in.
{
  const owner = client();
  const email = `link${t}@x.com`;
  await owner("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Link Owner", email, password: "password123" }) });
  const token = await verifyToken(email);
  const stranger = client();
  const r = await stranger("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
  const me = await stranger("/api/me");
  ok("verify link confirms without signing the opener in", r.status === 200 && r.j?.status === "verified" && !r.setCookie && me.j?.user === null, `${r.status} cookie=${r.setCookie} me=${me.j?.user?.email || null}`);
  // Someone else who is signed in keeps their own session.
  const other = await account(`other${t}@x.com`);
  const email2 = `link2${t}@x.com`;
  await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Link Two", email: email2, password: "password123" }) });
  const r2 = await other("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email2) }) });
  const me2 = await other("/api/me");
  ok("verify link keeps a signed-in visitor in their own account", r2.j?.status === "verified" && me2.j?.user?.email === `other${t}@x.com`, me2.j?.user?.email);
}

// 2. Parallel wrong passwords: every guess counts, so no more than 10 get through.
{
  const email = `burst${t}@x.com`;
  await account(email);
  const guesses = await Promise.all(Array.from({ length: 16 }, () => client()("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "wrong-password" }) })));
  const tried = guesses.filter((g) => g.status === 401).length;
  const locked = guesses.filter((g) => g.status === 429).length;
  ok("parallel wrong passwords can't exceed 10 tries", tried <= 10 && tried + locked === 16, `401=${tried} 429=${locked}`);
}

// 3. Photos added in parallel: none lost, never more than 6.
{
  const f = await account(`photos${t}@x.com`);
  const { j } = await f("/api/shoots", { method: "POST", body: "{}" });
  const sid = j.shoot.id;
  const ups = await Promise.all(Array.from({ length: 8 }, () => f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo }) })));
  const added = ups.filter((u) => u.status === 201).length;
  const shoot = (await f(`/api/shoots/${sid}`)).j.shoot;
  ok("parallel uploads: none lost, capped at 6", added === shoot.selfies.length && shoot.selfies.length <= 6 && added >= 1, `201=${added} stored=${shoot.selfies.length}`);

  // 4. A double-clicked photo check runs (and counts) once.
  const before = (await f("/api/me")).j.user.plan?.checksLeft;
  const [c1, c2] = await Promise.all([f(`/api/shoots/${sid}/check`, { method: "POST" }), f(`/api/shoots/${sid}/check`, { method: "POST" })]);
  const after = (await f("/api/me")).j.user.plan?.checksLeft;
  ok("double-clicked photo check runs once", [c1.status, c2.status].sort().join() === "200,409" && before - after === 1, `${c1.status},${c2.status} checksLeft ${before}->${after}`);
  // Photo edits are refused while a check runs and allowed after.
  const del = await f(`/api/shoots/${sid}/selfies/${shoot.selfies[0].file.split("/").pop()}`, { method: "DELETE" });
  ok("photo removal after the check works", del.status === 200 && del.j.shoot.selfies.length === shoot.selfies.length - 1, String(del.status));
}

// 5. Password reset request: same answer for known and unknown addresses.
{
  const known = await client()("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: `photos${t}@x.com` }) });
  const unknown = await client()("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: `nobody${t}@x.com` }) });
  await new Promise((r) => setTimeout(r, 800));
  const sent = (await mailFor(`photos${t}@x.com`)).some((m) => m.links.some((l) => l.includes("/reset?token=")));
  ok("reset request looks the same for known and unknown emails", known.status === 200 && unknown.status === 200 && known.j?.status === "sent" && unknown.j?.status === "sent" && sent, `${known.status},${unknown.status} emailed=${sent}`);
}

// 6. Admin token is accepted only in a header (never the query string). Needs
// the server started with ADMIN_TOKEN and the same value in QA_ADMIN_TOKEN.
if (process.env.QA_ADMIN_TOKEN) {
  const tok = process.env.QA_ADMIN_TOKEN;
  const q = await client()(`/api/admin/examples?token=${tok}`);
  const h = await client()("/api/admin/examples", { headers: { "x-admin-token": tok } });
  ok("admin token only accepted in a header", q.status === 404 && h.status === 200, `query=${q.status} header=${h.status}`);
}

// 7. Checkout: bad session ids are rejected; starts are rate-limited.
{
  const f = await account(`buyer${t}@x.com`);
  const bad = await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: "../../x" }) });
  ok("confirm rejects a malformed session id", bad.status === 400, String(bad.status));
  const starts = [];
  for (let i = 0; i < 11; i++) starts.push((await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) })).status);
  ok("checkout starts limited to 10 an hour", starts.slice(0, 10).every((s) => s === 200) && starts[10] === 429, starts.join(","));
  const sync = await f("/api/billing/sync", { method: "POST" });
  ok("purchase sync still works", sync.status === 200, String(sync.status));
}

// 8. Two sign-ups for the same address at once: exactly one account.
{
  const email = `twin${t}@x.com`;
  const [a, b] = await Promise.all([0, 1].map(() => client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Twin", email, password: "password123" }) })));
  ok("simultaneous sign-ups create one account", [a.status, b.status].sort().join() === "201,400", `${a.status},${b.status}`);
  const long = await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Long", email: `long${t}@x.com`, password: "x".repeat(300) }) });
  ok("over-long password rejected", long.status === 400 && !!long.j?.fields?.password, String(long.status));
}

// 9. The free photo checks are shared by every address for one mailbox.
{
  const base = `pa${t}`;
  const a = await account(`${base}@gmail.com`);
  const { j } = await a("/api/shoots", { method: "POST", body: "{}" });
  await a(`/api/shoots/${j.shoot.id}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  for (let i = 0; i < 4; i++) await a(`/api/shoots/${j.shoot.id}/check`, { method: "POST" });
  const b = await account(`${base}+second@gmail.com`);
  const left = (await b("/api/me")).j.user.plan.checksLeft;
  const s2 = (await b("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await b(`/api/shoots/${s2}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push((await b(`/api/shoots/${s2}/check`, { method: "POST" })).status);
  ok("plus-addresses share the mailbox's free checks", left === 2 && runs.join() === "200,200,402", `left=${left} checks=${runs.join(",")}`);
}

// 10. Signing out revokes that session: a copy of its cookie stops working,
// while the same account stays signed in on another device.
{
  const email = `revoke${t}@x.com`;
  await account(email);
  const signIn = async () => {
    const r = await fetch(B + "/api/auth/signin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "password123" }) });
    return r.headers.get("set-cookie").split(";")[0];
  };
  const [one, two] = [await signIn(), await signIn()];
  const me = (cookie) => fetch(B + "/api/me", { headers: { cookie } }).then((r) => r.json()).then((d) => d.user?.email || null);
  await fetch(B + "/api/auth/signout", { method: "POST", headers: { cookie: one } });
  const copied = await me(one);
  const other = await me(two);
  ok("sign-out revokes that session only", copied === null && other === email, `copied=${copied} other=${other}`);
}

// 11. The contact form's hourly limit is shared by every server instance.
// Needs a second server on the same storage at B2 (default :3101).
{
  const B2 = process.env.BASE2 || "http://localhost:3101";
  const up = await fetch(B2 + "/api/me").then(() => true).catch(() => false);
  if (up) {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch((i % 2 ? B2 : B) + "/api/contact", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${t % 200}` }, body: JSON.stringify({ name: "Rate Test", email: "rate@x.com", topic: "general", message: "Checking the shared hourly limit." }) });
      statuses.push(r.status);
    }
    ok("contact limit is shared across servers", statuses.slice(0, 5).every((s) => s === 200) && statuses[5] === 429, statuses.join(","));
  }
}

// --- Third QA pass ---
const signin = (email, password, ip) => fetch(B + "/api/auth/signin", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, password }) }).then((r) => r.status);

// 12. Wrong passwords lock out the network they come from, not the account.
{
  const email = `net${t}@x.com`;
  await account(email);
  const wrong = [];
  for (let i = 0; i < 11; i++) wrong.push(await signin(email, "wrong-password", "198.51.100.7"));
  const sameNet = await signin(email, "password123", "198.51.100.7");
  const otherNet = await signin(email, "password123", "198.51.100.8");
  ok("sign-in lock is per network, not per account", wrong.slice(0, 10).every((s) => s === 401) && wrong[10] === 429 && sameNet === 429 && otherNet === 200, `${wrong.join(",")} same=${sameNet} other=${otherNet}`);
}

// 12b. Wrong passwords just before the current 15-minute window began still
// count. Needs the server's DATA_DIR to seed the previous window.
if (process.env.DATA_DIR) {
  const { counterKey, hashId } = await import("../../lib/ratelimit.js");
  const email = `edge${t}@x.com`, ip = "198.51.100.21";
  await account(email);
  const file = `${process.env.DATA_DIR}/${counterKey("signin", email, 15 * 60 * 1000, 1)}`;
  fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ips: { [hashId(ip).slice(0, 12)]: 9 }, total: 9 }));
  const tries = [await signin(email, "wrong-password", ip), await signin(email, "password123", ip)];
  ok("sign-in lock counts the previous window too", tries[0] === 401 && tries[1] === 429, tries.join(","));
}

// 13. The public demo account can't be locked by wrong passwords.
{
  const wrong = [];
  for (let i = 0; i < 12; i++) wrong.push(await signin("demo@keeperheadshots.com", "wrong-password", "198.51.100.9"));
  const right = await signin("demo@keeperheadshots.com", "studio-demo", "198.51.100.9");
  ok("demo account can't be locked", wrong.every((s) => s === 401) && right === 200, `${[...new Set(wrong)].join(",")} then ${right}`);
}

// 14. Unknown addresses are counted the same way, so a 429 doesn't reveal accounts.
{
  const wrong = [];
  for (let i = 0; i < 11; i++) wrong.push(await signin(`nobody${t}@x.com`, "wrong-password", "198.51.100.10"));
  ok("unknown address locks like a real one", wrong[9] === 401 && wrong[10] === 429, wrong.slice(8).join(","));
}

// 15. Example images: only the canonical query does any work.
{
  const odd = await fetch(B + "/examples/hero-1.webp?w=360&v=5&x=123", { redirect: "manual" });
  const canon = await fetch(B + "/examples/hero-1.webp?w=360&v=5", { redirect: "manual" });
  ok("non-canonical example URL redirects", odd.status === 301 && odd.headers.get("location") === "/examples/hero-1.webp?w=360&v=5" && canon.status !== 301, `${odd.status} ${odd.headers.get("location")} canon=${canon.status}`);
}

// 15b. Landing pages point to their own social preview image, which renders.
{
  const og = async (p) => /<meta property="og:image" content="([^"]+)"/.exec(await (await fetch(B + p)).text())?.[1];
  const [re, contact] = [await og("/real-estate-headshots"), await og("/contact")];
  ok("landing pages have their own preview image", re?.endsWith("/og/real-estate.png") && contact?.endsWith("/og.png"), `${re} ${contact}`);
  const img = await fetch(B + "/og/real-estate.png");
  const buf = Buffer.from(await img.arrayBuffer());
  ok("the preview image renders at 1200×630", img.status === 200 && img.headers.get("content-type") === "image/png" && buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630, `${img.status} ${buf.length}`);
  ok("unknown preview images are 404", (await fetch(B + "/og/nothing.png")).status === 404);
}

// 15c. Soro's blog script is allowed on /blog pages only.
{
  const csp = async (p) => (await fetch(B + p)).headers.get("content-security-policy") || "";
  const [blog, post, home, buy] = [await csp("/blog"), await csp("/blog/some-article"), await csp("/"), await csp("/app/buy/starter")];
  ok("the blog allows Soro's script", /script-src[^;]*app\.trysoro\.com/.test(blog) && /script-src[^;]*app\.trysoro\.com/.test(post));
  ok("other pages don't", !/trysoro/.test(home) && !/trysoro/.test(buy));
  const page = await (await fetch(B + "/blog")).text();
  ok("the blog page carries Soro's snippet as given", page.includes('<div id="soro-blog"></div>') && page.includes('<script src="https://app.trysoro.com/api/embed/1cec6634-2353-4a99-a706-b269ffe2172d" defer></script>'));
  const art = await (await fetch(B + "/blog?post=professional-ai-headshots-from-selfies&utm_source=x")).text();
  ok("an article points search engines to its own address", art.includes('<link rel="canonical" href="https://keeperheadshots.com/blog?post=professional-ai-headshots-from-selfies" />') && art.includes("<title>Professional AI Headshots from Selfies · Keeper Headshots Blog</title>") && art.includes('og:type" content="article"') && art.includes('<div id="soro-blog"></div>'));
  const odd = await (await fetch(B + "/blog?post=%3Cscript%3E")).text();
  ok("an odd post value gets the plain blog page", odd.includes('<link rel="canonical" href="https://keeperheadshots.com/blog" />') && !odd.includes("%3Cscript"));
  ok("article addresses load the blog", (await fetch(B + "/blog/some-article")).status === 200 && (await fetch(B + "/blog/not.an.article")).status === 404);
}

// 15d. /llms.txt (a summary for AI search tools) is served and its prices
// match the packages, so it can't go stale when prices change.
{
  const r = await fetch(B + "/llms.txt");
  const txt = await r.text();
  const { PACKAGES } = await import("../../public/js/shared/catalog.js");
  ok("llms.txt is served as text", r.status === 200 && /text\/plain/.test(r.headers.get("content-type") || "") && txt.startsWith("# Keeper Headshots"));
  const wrong = PACKAGES.filter((p) => !txt.includes(`${p.name}: $${p.price} one-time, ${p.shoots} shoots`));
  ok("llms.txt prices match the packages", !wrong.length, wrong.map((p) => p.name).join(", "));
}

// 15e. The confirmation email's 6-digit code confirms the signed-in account
// only (for people who signed up in Facebook's in-app browser).
{
  const codeOf = async (email) => /(\d{6}) is your Keeper Headshots code/.exec((await mailFor(email)).map((m) => m.subject).join("\n"))?.[1];
  const a = client(), bee = client();
  const ea = `code${t}@x.com`, eb = `codeb${t}@x.com`;
  await a("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Code A", email: ea, password: "password123" }) });
  await bee("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Code B", email: eb, password: "password123" }) });
  const [ca, cb] = [await codeOf(ea), await codeOf(eb)];
  ok("the confirmation email carries a code", /^\d{6}$/.test(ca || "") && /^\d{6}$/.test(cb || ""), `${ca} ${cb}`);
  const wrong = await a("/api/auth/verify/code", { method: "POST", body: JSON.stringify({ code: ca === "000000" ? "000001" : "000000" }) });
  ok("a wrong code is refused", wrong.status === 400 && wrong.j.user === undefined);
  ok("another account's code is refused", (await a("/api/auth/verify/code", { method: "POST", body: JSON.stringify({ code: cb }) })).status === 400);
  ok("the code needs a signed-in account", (await client()("/api/auth/verify/code", { method: "POST", body: JSON.stringify({ code: ca }) })).status === 401);
  const good = await a("/api/auth/verify/code", { method: "POST", body: JSON.stringify({ code: `${ca.slice(0, 3)} ${ca.slice(3)}` }) });
  ok("the right code confirms the account", good.status === 200 && good.j.status === "verified" && good.j.user.emailVerified === true && good.j.user.plan.canDevelop === true, JSON.stringify(good.j));
  let limited = false;
  for (let i = 0; i < 10 && !limited; i++) limited = (await bee("/api/auth/verify/code", { method: "POST", body: JSON.stringify({ code: "111111" }) })).status === 429;
  ok("guessing is limited", limited);
}

// 16. At most 20 undeveloped shoots per account.
{
  const f = await account(`drafts${t}@x.com`);
  const made = [];
  for (let i = 0; i < 21; i++) made.push((await f("/api/shoots", { method: "POST", body: "{}" })).status);
  ok("undeveloped shoots capped at 20", made.slice(0, 20).every((s) => s === 201) && made[20] === 409, `${made.filter((s) => s === 201).length} made, then ${made[20]}`);
}

// 17. A re-check that's refused (daily limit) leaves the shoot checked, so it
// can still be developed. Needs the server's DATA_DIR to set the day's count.
if (process.env.DATA_DIR) {
  const fs = await import("node:fs");
  const email = `recheck${t}@x.com`;
  const f = await account(email);
  const { j } = await f("/api/shoots", { method: "POST", body: "{}" });
  const sid = j.shoot.id;
  await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
  const me = await f("/api/me");
  const file = `${process.env.DATA_DIR}/users/id/${me.j.user.id}.json`;
  const u = JSON.parse(fs.readFileSync(file, "utf8"));
  u.credits = 1;
  u.usage = { ...u.usage, checkDay: { date: new Date().toISOString().slice(0, 10), n: 40 } };
  fs.writeFileSync(file, JSON.stringify(u));
  const again = await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
  const after = await f(`/api/shoots/${sid}`);
  ok("refused re-check keeps the shoot checked", again.status === 429 && after.j.shoot.status === "checked" && !!after.j.shoot.check, `${again.status} ${after.j.shoot.status}`);
}

// 18. Signing out of the demo account doesn't grow its record.
{
  const f = client();
  await f("/api/auth/signin", { method: "POST", headers: { "x-forwarded-for": "198.51.100.11" }, body: JSON.stringify({ email: "demo@keeperheadshots.com", password: "studio-demo" }) });
  await f("/api/auth/signout", { method: "POST" });
  if (process.env.DATA_DIR) {
    const fs = await import("node:fs");
    const dir = `${process.env.DATA_DIR}/users/id`;
    const demo = fs.readdirSync(dir).map((n) => JSON.parse(fs.readFileSync(`${dir}/${n}`, "utf8"))).find((u) => u.demo);
    ok("demo sign-out isn't tracked", !(demo.revokedSessions || []).length, `${(demo.revokedSessions || []).length} entries`);
  }
}

const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
