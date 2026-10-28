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
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email) }) });
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
  // Another browser is asked whether it made the account first.
  const asked = await stranger("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
  ok("verify link in another browser asks who made the account", asked.status === 200 && asked.j?.status === "ask", `${asked.status} ${asked.j?.status}`);
  const r = await stranger("/api/auth/verify", { method: "POST", body: JSON.stringify({ token, created: true }) });
  const me = await stranger("/api/me");
  ok("verify link confirms without signing the opener in", r.status === 200 && r.j?.status === "verified" && !r.setCookie && me.j?.user === null, `${r.status} cookie=${r.setCookie} me=${me.j?.user?.email || null}`);
  const maker = await owner("/api/me");
  ok("…and \"yes\" leaves the maker signed in, now confirmed", maker.j?.user?.emailVerified === true, JSON.stringify(maker.j?.user?.emailVerified));
  // Someone else who is signed in keeps their own session.
  const other = await account(`other${t}@x.com`);
  const email2 = `link2${t}@x.com`;
  await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Link Two", email: email2, password: "password123" }) });
  const r2 = await other("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email2), created: true }) });
  const me2 = await other("/api/me");
  ok("verify link keeps a signed-in visitor in their own account", r2.j?.status === "verified" && me2.j?.user?.email === `other${t}@x.com`, me2.j?.user?.email);
  // The browser that made the account isn't asked.
  const email3 = `link3${t}@x.com`;
  const same = jarClient(); // keeps the "made this account" cookie
  await same("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Link Three", email: email3, password: "password123" }) });
  const r3 = await same("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email3) }) });
  ok("verify link in the browser that made the account confirms straight away", r3.j?.status === "verified", r3.j?.status);
  // A browser that's only signed in to the account is asked too.
  const email4 = `link4${t}@x.com`;
  await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Link Four", email: email4, password: "password123" }) });
  const signedIn = client();
  await signedIn("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: email4, password: "password123" }) });
  const r4 = await signedIn("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email4) }) });
  ok("a browser only signed in to the account is asked who made it", r4.j?.status === "ask", r4.j?.status);
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
  const s2 = (await b("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  // (With the mailbox's free shoot used: before it, more checks come from a
  // daily allowance; see check-gate-tests.js.)
  await a(`/api/shoots/${j.shoot.id}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }] }) });
  const left = (await b("/api/me")).j.user.plan.checksLeft;
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
  ok("unknown preview images are 404", (await fetch(B + "/og/nothing.png")).status === 404 && (await fetch(B + "/og/constructor.png")).status === 404 && (await fetch(B + "/og/toString.png")).status === 404);
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
  // Any slug is accepted while the embed is in use, so these pages stay out
  // of search (the feed's real articles live at /blog/<slug>).
  ok("an embed article is shown but kept out of search", art.includes('<link rel="canonical" href="https://keeperheadshots.com/blog" />') && art.includes('<meta name="robots" content="noindex, follow" />') && art.includes("<title>Professional AI Headshots from Selfies · Keeper Headshots Blog</title>") && art.includes('<div id="soro-blog"></div>'));
  const odd = await (await fetch(B + "/blog?post=%3Cscript%3E")).text();
  ok("an odd post value gets the plain blog page", odd.includes('<link rel="canonical" href="https://keeperheadshots.com/blog" />') && !odd.includes("%3Cscript"));
  ok("article addresses load the blog", (await fetch(B + "/blog/some-article")).status === 200 && (await fetch(B + "/blog/not.an.article")).status === 404);
  // Without the feed, any address is accepted too: kept out of search the same way.
  const loose = await (await fetch(B + "/blog/some-article")).text();
  ok("an article address without the feed is kept out of search", loose.includes('<link rel="canonical" href="https://keeperheadshots.com/blog" />') && loose.includes('<meta name="robots" content="noindex, follow" />'));
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

// 15f. Deleting and re-creating the account (or using another form of the
// same Gmail address) doesn't buy more code guesses: 20 a day per inbox.
{
  const base = `cap${t}`;
  const forms = [`${base}@gmail.com`, `${base.slice(0, 2)}.${base.slice(2)}@gmail.com`, `${base}+again@gmail.com`];
  let wrong = 0, limitedAt = null;
  for (const [n, email] of forms.entries()) {
    const c = client();
    const ip = { "x-forwarded-for": `198.51.100.${(t % 200) + n}` };
    await c("/api/auth/signup", { method: "POST", headers: ip, body: JSON.stringify({ name: "Cap Test", email, password: "password123" }) });
    for (let i = 0; i < 8 && limitedAt === null; i++) {
      const r = await c("/api/auth/verify/code", { method: "POST", headers: ip, body: JSON.stringify({ code: "111111" }) });
      if (r.status === 429) limitedAt = wrong;
      else if (r.status === 400) wrong++;
    }
  }
  ok("code guesses are capped per inbox across re-created accounts", limitedAt === 20, `limited after ${limitedAt} wrong tries`);
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

// 19. One inbox can't create accounts all day under +tags and dots.
{
  const base = `flood.box${t}`;
  const tries = [];
  for (const local of [base, `${base}+a`, `${base}+b`, `${base.replace(/\./g, "")}+c`]) {
    tries.push((await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Flood Box", email: `${local}@gmail.com`, password: "password123" }) })).status);
  }
  ok("a fourth account for one Gmail inbox in a day is refused", JSON.stringify(tries) === "[201,201,201,429]", JSON.stringify(tries));
}

// 20. One network can't mass-create accounts.
{
  const ip = `203.0.113.${(t + 7) % 250}`;
  const up = (i) => fetch(B + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ name: "Net Flood", email: `netflood${i}.${t}@x.com`, password: "password123" }) }).then((r) => r.status);
  const statuses = [];
  const hour = new Date().getUTCHours();
  for (let i = 0; i < 121; i += 11) statuses.push(...(await Promise.all(Array.from({ length: 11 }, (_, k) => up(i + k)))));
  // The counter is per clock hour; a run straddling the hour sees two windows.
  const straddled = new Date().getUTCHours() !== hour;
  // Requests in a batch finish in any order, so the refused one is whichever
  // the server counted last.
  const created = statuses.filter((s) => s === 201).length, refusedCount = statuses.filter((s) => s === 429).length;
  ok("the 121st new account from one network in an hour is refused", straddled || (created === 120 && refusedCount === 1), straddled ? "skipped: the hour changed during the test" : `${created} created, ${refusedCount} refused`);
  const other = await fetch(B + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.251" }, body: JSON.stringify({ name: "Elsewhere", email: `elsewhere${t}@x.com`, password: "password123" }) });
  ok("other networks still can", other.status === 201, String(other.status));
}

// 21. Deleting the account isn't a place to guess the password.
{
  const email = `guessdel${t}@x.com`;
  const f = await account(email);
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await f("/api/account/delete", { method: "POST", body: JSON.stringify({ password: `wrong-${i}` }) })).status);
  ok("ten wrong passwords on account deletion, then it's refused", codes.slice(0, 10).every((s) => s === 401) && codes[10] === 429, JSON.stringify(codes));
  ok("the account is still there", (await f("/api/me")).j?.user?.email === email);
}

// 22. The landing pages' structured data quotes the price the page shows.
{
  const html = await fetch(B + "/linkedin-headshots").then((r) => r.text());
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const agg = blocks.flatMap((b) => [].concat(b["@graph"] || b)).map((b) => b.offers).find((o) => o?.["@type"] === "AggregateOffer");
  // (Only the packages: the offers to keep a free preview aren't public prices.)
  ok("landing page offers start at the cheapest package", agg?.lowPrice === "29" && agg?.highPrice === "49" && agg?.offerCount === "3", JSON.stringify(agg));
}

// 23. Email copy for edge counts and several team looks.
{
  const mail = await import("../../lib/mail.js");
  const one = mail.readyEmail({ name: "Sam", shootName: "Monday", count: 1, link: "https://x/app" });
  ok("the ready email reads right for a single headshot", /1 headshot, checked for likeness and graded\./.test(one.text) && !/each/.test(one.text), one.text.split("\n")[2]);
  const inv = mail.teamInviteEmail({ ownerName: "Ada", teamName: "Acme", link: "https://x/join/t", looks: ["Glass Office · Navy Suit", "Studio Gray · White Shirt"] });
  ok("the invite email says looks when there are several", /team's looks \(Glass Office · Navy Suit and Studio Gray · White Shirt\)/.test(inv.text), inv.text.split("\n")[2]);
  ok("and names the admin and team", inv.subject === "Ada invited you to get your Acme headshot" && /Ada sees only/.test(inv.text) && /<b>Acme<\/b>/.test(inv.html), inv.subject);
  const phish = mail.teamInviteEmail({ ownerName: "Payroll: re-verify at keeper-pay.xyz", teamName: "Payroll: re-verify at keeper-pay.xyz today", link: "https://x/join/t", looks: ["Studio Gray · White Shirt"] });
  ok("a name or team name that reads like a web address isn't sent", !/keeper-pay/i.test(phish.subject + phish.text + phish.html) && phish.subject === "Your team admin invited you to get your team headshot" && /they see only/.test(phish.text), phish.subject);
  const v = mail.verificationEmail({ name: "Sam", link: "https://x/verify?token=t", code: "123456" });
  ok("the confirmation email only asks to confirm the address (no free shoot)", /to confirm your email address/.test(v.text) && !/free/i.test(v.subject + v.text + v.html));
  // Marketing law: reminder and offer emails carry the postal address; account emails needn't.
  const rem = mail.reminderEmail({ kind: "develop", name: "Sam", link: "https://x/app", pricing: "https://x/#pricing", unsubscribe: "https://x/unsubscribe?token=t" });
  const off = mail.offerEmail({ name: "Sam", code: "KEEP20", discount: "20% off", until: "Sunday", link: "https://x/app", pricing: "https://x/#pricing", usedFree: true, preview: true, unsubscribe: "https://x/unsubscribe?token=t" });
  const addr = /7006 Peckham Street, Johnston, IA 50131/;
  ok("reminder and offer emails carry the postal address", addr.test(rem.text) && addr.test(rem.html) && addr.test(off.text) && addr.test(off.html) && !addr.test(v.html));
}

// 24. A develop claim left by an instance that died between charging and
// writing the plan is taken over after two minutes, and its charge isn't repeated.
if (process.env.DATA_DIR) {
  const f = await account(`claim${t}@x.com`);
  const uid = (await f("/api/me")).j.user.id;
  const LOOK = { looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }] };
  const checked = async () => {
    const sid = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
    await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
    await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
    for (let w = 0; w < 80 && (await f(`/api/shoots/${sid}`)).j.shoot.status === "checking"; w++) await new Promise((r) => setTimeout(r, 250));
    return sid;
  };
  const claim = (sid, minutesAgo) => {
    const file = `${process.env.DATA_DIR}/claims/develop/${sid}.json`;
    fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ userId: uid, at: new Date(Date.now() - minutesAgo * 60_000).toISOString() }));
  };
  const s1 = await checked();
  claim(s1, 1);
  const fresh = await f(`/api/shoots/${s1}/generate`, { method: "POST", body: JSON.stringify(LOOK) });
  claim(s1, 3);
  const taken = await f(`/api/shoots/${s1}/generate`, { method: "POST", body: JSON.stringify(LOOK) });
  ok("a fresh develop claim is respected, a stale one taken over", fresh.status === 409 && taken.status === 202 && (await f("/api/me")).j.user.plan.freeShootAvailable === false, `${fresh.status} ${taken.status}`);
  // The earlier try had already charged a credit: it isn't charged again.
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sess = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sess}?promo=FREE`, { redirect: "manual" });
  await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sess }) });
  const s2 = await checked();
  const userFile = `${process.env.DATA_DIR}/users/id/${uid}.json`;
  const u = JSON.parse(fs.readFileSync(userFile, "utf8"));
  fs.writeFileSync(userFile, JSON.stringify({ ...u, credits: 2, developing: { [s2]: "credit" } }));
  claim(s2, 3);
  const again = await f(`/api/shoots/${s2}/generate`, { method: "POST", body: JSON.stringify(LOOK) });
  const after = (await f("/api/me")).j.user;
  ok("a charge made by the earlier try isn't made again", again.status === 202 && after.plan.credits === 2 && !JSON.parse(fs.readFileSync(userFile, "utf8")).developing?.[s2], `${again.status} credits=${after.plan.credits}`);
}

// 25. Odd request bodies and names.
{
  const f = client();
  const odd = await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: { toString: 1 } }) });
  const nested = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Odd Person", email: `odd${t}@x.com`, password: { valueOf: 1 } }) });
  ok("a body value that can't be turned into text is refused, not a crash", odd.status === 400 && nested.status === 400, `${odd.status} ${nested.status}`);
  const bidi = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Ada \u202Egnitekram\u202C Lovelace", email: `bidi${t}@x.com`, password: "password123" }) });
  const zw = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Ada\u200B Lovelace", email: `zw${t}@x.com`, password: "password123" }) });
  ok("names can't carry direction or zero-width characters", bidi.status === 400 && zw.status === 400, `${bidi.status} ${zw.status}`);
}

// 26. A download link opened after signing out goes to the sign-in page, not to a saved error file.
{
  const f = await account(`dl${t}@x.com`);
  const sid = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  const file = (await f(`/api/shoots/${sid}`)).j.shoot.selfies[0].file;
  const anon = await fetch(`${B}/media/${file}?download=1`, { redirect: "manual" });
  const page = await fetch(`${B}/media/${file}`, { redirect: "manual", headers: { accept: "text/html,*/*" } });
  const xhr = await fetch(`${B}/media/${file}`, { redirect: "manual", headers: { accept: "image/*" } });
  const head = await fetch(`${B}/media/${file}?download=1`, { method: "HEAD", redirect: "manual" });
  ok("signed-out download → sign-in page, signed-out image fetch and the page's HEAD check → 401", anon.status === 302 && (anon.headers.get("location") || "").startsWith(`/signin?next=%2Fapp%2Fshoot%2F${sid}`) && page.status === 302 && xhr.status === 401 && head.status === 401, `${anon.status} ${anon.headers.get("location")} ${page.status} ${xhr.status} ${head.status}`);
}

// 27. Someone signs up with your address, never confirms it, pays and
// uploads. When you take the account over with "Forgot password", what they
// uploaded goes; the payment and its shoots balance stay.
{
  const email = `takeover${t}@x.com`;
  const stranger = client();
  await stranger("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Not You", email, password: "password123" }) });
  const { j } = await stranger("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sess = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sess}?promo=FREE`, { redirect: "manual" });
  await stranger("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sess }) });
  const sid = (await stranger("/api/shoots", { method: "POST", body: "{}" })).j?.shoot?.id;
  await stranger(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  const file = (await stranger(`/api/shoots/${sid}`)).j?.shoot?.selfies?.[0]?.file;
  const owner = client();
  await owner("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) });
  await new Promise((r) => setTimeout(r, 800));
  const link = (await mailFor(email)).flatMap((m) => m.links).findLast((l) => l.includes("/reset?token="));
  const reset = await owner("/api/auth/password/reset", { method: "POST", body: JSON.stringify({ token: new URL(link).searchParams.get("token"), password: "mine-for-real-1" }) });
  const list = (await owner("/api/shoots")).j;
  const me = (await owner("/api/me")).j.user;
  const media = await owner(`/media/${file}`, { headers: { accept: "image/*" } });
  ok("taking over an unconfirmed account removes what the stranger uploaded, keeps the balance", !!sid && !!file && reset.status === 200 && (list.shoots || []).length === 0 && media.status === 404 && me.plan.credits === 3 && me.emailVerified === true, `${sid} ${reset.status} shoots=${(list.shoots || []).length} media=${media.status} credits=${me.plan.credits}`);
}

// A client that keeps every cookie, including the device ones.
function jarClient() {
  const jar = new Map();
  return async (p, o = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(B + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
    for (const c of r.headers.getSetCookie?.() || []) {
      const [kv] = c.split(";");
      const at = kv.indexOf("=");
      jar.set(kv.slice(0, at), kv.slice(at + 1));
    }
    let j = null;
    try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
}
const shootWithSelfie = async (dev) => {
  const { j } = await dev("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sess = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sess}?promo=FREE`, { redirect: "manual" });
  await dev("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sess }) });
  const sid = (await dev("/api/shoots", { method: "POST", body: "{}" })).j?.shoot?.id;
  await dev(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  return sid;
};
const resetFrom = async (dev, email, password) => {
  await dev("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) });
  await new Promise((r) => setTimeout(r, 800));
  const link = (await mailFor(email)).flatMap((m) => m.links).findLast((l) => l.includes("/reset?token="));
  return dev("/api/auth/password/reset", { method: "POST", body: JSON.stringify({ token: new URL(link).searchParams.get("token"), password }) });
};

// 27b. The same reset from the browser that made the account is its owner,
// who keeps their shoots.
{
  const dev = jarClient();
  const email = `samedev${t}@x.com`;
  await dev("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Real Owner", email, password: "password123" }) });
  const sid = await shootWithSelfie(dev);
  const reset = await resetFrom(dev, email, "still-mine-123");
  const list = (await dev("/api/shoots")).j;
  ok("a reset from the device that made the account keeps its shoots", !!sid && reset.status === 200 && (list.shoots || []).some((s) => s.id === sid), `${reset.status} shoots=${(list.shoots || []).length}`);
}

// 27c. A browser that only signed in to the account (say, a shared computer
// the maker used once) isn't the one that made it: the shoots still go.
{
  const maker = jarClient();
  const email = `otherdev${t}@x.com`;
  await maker("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Squatter", email, password: "password123" }) });
  const sid = await shootWithSelfie(maker);
  const shared = jarClient();
  const signin = await shared("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
  const reset = await resetFrom(shared, email, "the-real-owner-9");
  const list = (await shared("/api/shoots")).j;
  ok("a reset from a browser that only signed in still removes the maker's shoots", !!sid && signin.status === 200 && reset.status === 200 && (list.shoots || []).length === 0, `${signin.status} ${reset.status} shoots=${(list.shoots || []).length}`);
}

// 27d. A takeover that lands while a develop holds its charge (the account
// records it until the shoot starts) gives that credit back.
if (process.env.DATA_DIR) {
  const maker = jarClient();
  const email = `midcharge${t}@x.com`;
  await maker("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Squatter", email, password: "password123" }) });
  const sid = await shootWithSelfie(maker);
  const credits = async (c) => (await c("/api/me")).j?.user?.plan?.credits;
  const before = await credits(maker);
  const file = `${process.env.DATA_DIR}/users/id/${(await maker("/api/me")).j.user.id}.json`;
  const u = JSON.parse(fs.readFileSync(file, "utf8"));
  u.credits -= 1;
  u.developing = { [sid]: "credit" };
  fs.writeFileSync(file, JSON.stringify(u));
  const owner = jarClient();
  const reset = await resetFrom(owner, email, "the-real-owner-7");
  const after = await credits(owner);
  ok("a takeover during a develop's charge gives the credit back", reset.status === 200 && after === before, `${reset.status} credits ${before}->${after}`);
}

// 27e. Customers pay before confirming their address, so a takeover from
// another device keeps shoots with finished headshots (and what was bought
// for them), and still removes drafts.
if (process.env.DATA_DIR) {
  const maker = jarClient();
  const email = `paidwork${t}@x.com`;
  await maker("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Paying Customer", email, password: "password123" }) });
  const done = await shootWithSelfie(maker);
  const draft = await shootWithSelfie(maker);
  const developing = await shootWithSelfie(maker);
  // A paid develop whose frames all failed, waiting for a free retry.
  const errored = await shootWithSelfie(maker);
  const errFile = `${process.env.DATA_DIR}/shoots/${errored}.json`;
  const errMeta = JSON.parse(fs.readFileSync(errFile, "utf8"));
  errMeta.shots = [{ id: "shot_paidwork3" }];
  errMeta.status = "error";
  fs.writeFileSync(errFile, JSON.stringify(errMeta));
  fs.mkdirSync(`${process.env.DATA_DIR}/shots/${errored}`, { recursive: true });
  fs.writeFileSync(`${process.env.DATA_DIR}/shots/${errored}/shot_paidwork3.json`, JSON.stringify({ id: "shot_paidwork3", status: "error" }));
  const devFile = `${process.env.DATA_DIR}/shoots/${developing}.json`;
  const devMeta = JSON.parse(fs.readFileSync(devFile, "utf8"));
  devMeta.shots = [{ id: "shot_paidwork2" }];
  devMeta.status = "generating";
  fs.writeFileSync(devFile, JSON.stringify(devMeta));
  const selfie = (await maker(`/api/shoots/${done}`)).j?.shoot?.selfies?.[0]?.file;
  const metaFile = `${process.env.DATA_DIR}/shoots/${done}.json`;
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  meta.shots = [{ id: "shot_paidwork1" }];
  meta.status = "done";
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  fs.mkdirSync(`${process.env.DATA_DIR}/shots/${done}`, { recursive: true });
  fs.writeFileSync(`${process.env.DATA_DIR}/shots/${done}/shot_paidwork1.json`, JSON.stringify({ id: "shot_paidwork1", status: "done", file: `${done}/finished.jpg` }));
  const userFile = `${process.env.DATA_DIR}/users/id/${(await maker("/api/me")).j.user.id}.json`;
  const u = JSON.parse(fs.readFileSync(userFile, "utf8"));
  u.kept = { [done]: ["shot_paidwork1"], [draft]: ["shot_x"] };
  fs.writeFileSync(userFile, JSON.stringify(u));
  const owner = jarClient();
  const reset = await resetFrom(owner, email, "the-real-owner-5");
  const ids = ((await owner("/api/shoots")).j.shoots || []).map((s) => s.id);
  const me = (await owner("/api/me")).j.user;
  ok("a takeover keeps shoots with finished headshots, and removes drafts", reset.status === 200 && ids.includes(done) && !ids.includes(draft) && JSON.stringify(Object.keys(me.kept)) === JSON.stringify([done]), `${reset.status} shoots=${ids} kept=${Object.keys(me.kept || {})}`);
  ok("and a shoot still developing", ids.includes(developing), `shoots=${ids}`);
  const after = (await owner(`/api/shoots/${done}`)).j?.shoot;
  const selfieMedia = await owner(`/media/${selfie}`, { headers: { accept: "image/*" } });
  ok("but not the selfies the earlier holder uploaded", !!selfie && (after?.selfies || []).length === 0 && selfieMedia.status === 404, `${(after?.selfies || []).length} ${selfieMedia.status}`);
  // The developing shoot still needs its selfies for its frames: they're
  // marked to go when it finishes, and the takeover stays on record (with a
  // marker for the nightly clean-up) until then.
  const dev = JSON.parse(fs.readFileSync(devFile, "utf8"));
  const takenOver = JSON.parse(fs.readFileSync(userFile, "utf8"));
  ok("a developing shoot keeps its selfies until it finishes", Array.isArray(dev.dropSelfies) && dev.dropSelfies.length === 1 && (dev.selfies || []).length > 0 && !!takenOver.takeoverPurge && fs.existsSync(`${process.env.DATA_DIR}/takeovers/${takenOver.id}.json`), `${dev.dropSelfies} ${(dev.selfies || []).length} ${takenOver.takeoverPurge}`);
  ok("and the earlier holder's browsers stop counting as known devices", takenOver.deviceEpoch === 1, `${takenOver.deviceEpoch}`);
  const err = JSON.parse(fs.readFileSync(errFile, "utf8"));
  const marker = JSON.parse(fs.readFileSync(`${process.env.DATA_DIR}/takeovers/${takenOver.id}.json`, "utf8"));
  ok("a failed shoot keeps its selfies for its retry, marked to go once it develops", (err.selfies || []).length === 1 && Array.isArray(err.dropSelfies) && err.dropSelfies.length === 1, `${(err.selfies || []).length} ${JSON.stringify(err.dropSelfies)}`);
  ok("the takeover records which shoots and photos were the earlier holder's", JSON.stringify(Object.keys(marker.plan || {}).sort()) === JSON.stringify([done, draft, developing, errored].sort()), JSON.stringify(Object.keys(marker.plan || {})));
  const devSelfie = dev.selfies?.[0]?.file;
  ok("the earlier holder's selfies on a developing shoot aren't shown meanwhile", !!devSelfie && (await owner(`/media/${devSelfie}`)).status === 404);
  const listed = ((await owner("/api/shoots")).j?.shoots || []).find((x) => x.id === developing);
  const renamed = await owner(`/api/shoots/${developing}`, { method: "PATCH", body: JSON.stringify({ name: "Mine now" }) });
  ok("nor listed anywhere else (shoot list, rename)", listed && listed.selfieCount === 0 && listed.cover !== devSelfie && renamed.status === 200 && (renamed.j?.shoot?.selfies || []).length === 0 && !renamed.j?.shoot?.dropSelfies, `${JSON.stringify(listed)} ${renamed.status} ${(renamed.j?.shoot?.selfies || []).length}`);
  const regrade = await owner(`/api/shoots/${done}/review`, { method: "POST", body: "{}" });
  ok("a shoot whose selfies are gone can't be regraded or extended against nothing", regrade.status === 409 && regrade.j?.code === "no_selfies", `${regrade.status} ${regrade.j?.code}`);
}

// 27g. The confirmation link, opened by the inbox's owner who didn't make the
// account ("No, it wasn't me"): the maker is signed out, their password goes,
// and so do the selfies they uploaded.
{
  const maker = jarClient();
  const email = `notme${t}@x.com`;
  const madeBy = await maker("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Squatter", email, password: "password123" }) });
  const makerOrigin = process.env.DATA_DIR ? JSON.parse(fs.readFileSync(`${process.env.DATA_DIR}/users/id/${madeBy.j.user.id}.json`, "utf8")).originDevice : null;
  const sid = await shootWithSelfie(maker);
  const selfie = (await maker(`/api/shoots/${sid}`)).j?.shoot?.selfies?.[0]?.file;
  await new Promise((r) => setTimeout(r, 300));
  const link = (await mailFor(email)).flatMap((m) => m.links).findLast((l) => l.includes("/verify?token="));
  const inbox = jarClient();
  const no = await inbox("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: new URL(link).searchParams.get("token"), created: false }) });
  ok("\"No, it wasn't me\" hands the account to the inbox's owner", no.status === 200 && no.j?.status === "secured" && no.j?.email === email && !no.j?.user, JSON.stringify(no.j));
  ok("…signing out the maker", !(await maker("/api/me")).j?.user);
  const pw = await client()("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
  ok("…whose password no longer signs in", pw.status === 401, String(pw.status));
  // (A draft goes entirely: it had nothing but their selfies.)
  const metaFile = `${process.env.DATA_DIR}/shoots/${sid}.json`;
  const meta = process.env.DATA_DIR && fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : null;
  const gone = process.env.DATA_DIR ? !fs.existsSync(`${process.env.DATA_DIR}/media/${selfie}`) : true;
  ok("…and whose selfies are removed", !!selfie && gone && !(meta?.selfies || []).some((x) => x.file === selfie), `${JSON.stringify(meta?.selfies)} gone=${gone}`);
  const again = await inbox("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: new URL(link).searchParams.get("token"), created: false }) });
  ok("…once: the link then says it's already confirmed", again.j?.status === "already", again.j?.status);
  if (process.env.DATA_DIR) {
    const u = JSON.parse(fs.readFileSync(`${process.env.DATA_DIR}/users/id/${madeBy.j.user.id}.json`, "utf8"));
    ok("…and the maker's browser no longer counts as the one that made it", !!u.originDevice && u.originDevice !== makerOrigin, `${u.originDevice} ${makerOrigin}`);
  }
}


// 27h. A password reset from another browser on a confirmed account: the
// browsers that knew the old password stop counting as known devices.
if (process.env.DATA_DIR) {
  const dev = jarClient();
  const email = `epoch${t}@x.com`;
  await dev("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Epoch Owner", email, password: "password123" }) });
  await dev("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email) }) });
  const uid = (await dev("/api/me")).j.user.id;
  const reset = await resetFrom(jarClient(), email, "a-new-password-1");
  const u = JSON.parse(fs.readFileSync(`${process.env.DATA_DIR}/users/id/${uid}.json`, "utf8"));
  ok("a reset from another browser on a confirmed account renews the known devices", reset.status === 200 && u.emailVerified === true && u.deviceEpoch === 1, `${reset.status} ${u.deviceEpoch}`);
}

// 27i. Requests that change something are refused when another site sends
// them (its page's Origin), even as a "simple" form-style request.
{
  const f = await account(`origin${t}@x.com`);
  const evil = await f("/api/auth/signout-all", { method: "POST", headers: { "content-type": "text/plain", origin: "https://evil.example" }, body: "{}" });
  const sub = await f("/api/account/preferences", { method: "POST", headers: { origin: "https://shop.keeperheadshots.com.evil.example" }, body: JSON.stringify({ name: "Pwned Name" }) });
  const nul = await f("/api/account/preferences", { method: "POST", headers: { origin: "null" }, body: JSON.stringify({ name: "Pwned Name" }) });
  const still = await f("/api/me");
  ok("a request from another site's page is refused", evil.status === 403 && sub.status === 403 && nul.status === 403 && !!still.j?.user && still.j.user.name !== "Pwned Name", `${evil.status} ${sub.status} ${nul.status}`);
  const own = await f("/api/account/preferences", { method: "POST", headers: { origin: B }, body: JSON.stringify({ name: "Own Page" }) });
  ok("…while one from the site's own page goes through", own.status === 200, String(own.status));
  const addr = await f("/api/account/preferences", { method: "POST", body: JSON.stringify({ name: "Visit shop.io today" }) });
  ok("a name with a web address is refused when changing it", addr.status === 400 && addr.j?.field === "name", String(addr.status));
  const initials = await f("/api/account/preferences", { method: "POST", body: JSON.stringify({ name: "J.R. Smith" }) });
  ok("…while initials are fine", initials.status === 200, String(initials.status));
}

// 27f. Customers change their own name (not their email) on the account page.
{
  const f = client();
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Old Name", email: `rename${t}@x.com`, password: "password123" }) });
  const renamed = await f("/api/account/preferences", { method: "POST", body: JSON.stringify({ name: "  New   Name " }) });
  const link = await f("/api/account/preferences", { method: "POST", body: JSON.stringify({ name: "Visit https://spam.example" }) });
  const short = await f("/api/account/preferences", { method: "POST", body: JSON.stringify({ name: "x" }) });
  const seen = await f("/api/account/preferences", { method: "POST", body: JSON.stringify({ refundSeen: true }) });
  ok("a customer can change their name", renamed.status === 200 && renamed.j?.user?.name === "New Name", `${renamed.status} ${renamed.j?.user?.name}`);
  ok("but not to a link or a single letter", link.status === 400 && short.status === 400 && (await f("/api/me")).j.user.name === "New Name", `${link.status} ${short.status}`);
  ok("marking the refund notice seen works with no refunds", seen.status === 200 && seen.j?.user?.refundNotice === 0, `${seen.status}`);
}

// 29. Public pages may be cached by Vercel's CDN briefly; API answers aren't.
{
  const home = await fetch(B + "/");
  const me = await fetch(B + "/api/me");
  ok("public pages carry a short CDN cache, APIs don't", /max-age=60/.test(home.headers.get("vercel-cdn-cache-control") || "") && !home.headers.get("set-cookie") && !me.headers.get("vercel-cdn-cache-control"), `${home.headers.get("vercel-cdn-cache-control")} / ${me.headers.get("vercel-cdn-cache-control")}`);
}
// 29a. Browsers and crawlers that ask for /favicon.ico get the icon.
{
  const ico = await fetch(B + "/favicon.ico");
  const bytes = Buffer.from(await ico.arrayBuffer());
  ok("/favicon.ico is served", ico.status === 200 && bytes.readUInt16LE(2) === 1 && bytes.readUInt16LE(4) >= 1, `${ico.status} ${ico.headers.get("content-type")}`);
}

// 28. A body nested deeper than the guard looks is refused, not a crash.
{
  let deep = { toString: 1 };
  for (let i = 0; i < 9; i++) deep = [deep];
  const r = await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: deep, email: `deep${t}@x.com`, password: "password123" }) });
  ok("a deeply nested body is refused with 400", r.status === 400, String(r.status));
}

// 29. A name with commas can't add recipients to an email: the display name
// is quoted. Names with "@" or a web address are refused outright.
{
  const email = `comma${t}@x.com`;
  await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Jo, Attacker, Smith", email, password: "password123" }) });
  const m = (await mailFor(email)).find((x) => x.rawTo);
  ok("an email's display name is quoted", m && m.rawTo.length === 1 && m.rawTo[0].startsWith('"Jo, Attacker, Smith" <') && m.to.length === 1, JSON.stringify(m?.rawTo));
  for (const [i, name] of ["Jo attacker@evil.example", "Jo from evil.com", "evil\uff0ecom Smith", "Bob evil.c\u00adom", "Ann keeper-refunds.xyz"].entries()) {
    const r = await client()("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email: `addr${t}-${i}@x.com`, password: "password123" }) });
    ok(`a name like "${name}" is refused at sign-up`, r.status === 400 && !!r.j?.fields?.name, String(r.status));
  }
}

// 30. Several develop requests at once on a stale claim: exactly one goes
// ahead, and the account is charged exactly once.
if (process.env.DATA_DIR) {
  const f = await account(`stampede${t}@x.com`);
  const uid = (await f("/api/me")).j.user.id;
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sess = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sess}?promo=FREE`, { redirect: "manual" });
  await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sess }) });
  // The free shoot first, so the shoot below is paid with a credit.
  const shootWith = async () => {
    const sid = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
    await f(`/api/shoots/${sid}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
    await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
    for (let w = 0; w < 80 && (await f(`/api/shoots/${sid}`)).j.shoot.status === "checking"; w++) await new Promise((r) => setTimeout(r, 250));
    return sid;
  };
  const LOOK = JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }] });
  await f(`/api/shoots/${await shootWith()}/generate`, { method: "POST", body: LOOK });
  const sid = await shootWith();
  const file = `${process.env.DATA_DIR}/claims/develop/${sid}.json`;
  fs.mkdirSync(file.replace(/\/[^/]+$/, ""), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ userId: uid, at: new Date(Date.now() - 5 * 60_000).toISOString() }));
  const before = (await f("/api/me")).j.user.plan.credits;
  const rs = await Promise.all([1, 2, 3, 4].map(() => f(`/api/shoots/${sid}/generate`, { method: "POST", body: LOOK })));
  await new Promise((r) => setTimeout(r, 300));
  const after = (await f("/api/me")).j.user.plan.credits;
  ok("several develops on a stale claim charge exactly once", rs.filter((r) => r.status === 202).length === 1 && after === before - 1, `${rs.map((r) => r.status).join(",")} credits ${before}->${after}`);
}

const passed = results.filter((r) => r[1]).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
