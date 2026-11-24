// DEV/QA ONLY — password reset and "sign out everywhere" checks. Run against a
// local server wired to scripts/dev/mock-ai.js with RESEND_API_KEY=test
// RESEND_BASE_URL=http://localhost:4010:  node scripts/dev/reset-tests.js
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const results = [];
const ok = (name, cond, extra = "") => (results.push([name, !!cond]), console.log(cond ? "PASS" : "FAIL", name, extra));
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
const post = (f, p, body) => f(p, { method: "POST", body: JSON.stringify(body || {}) });
const inbox = async (email) => (await fetch(`${M}/mock-mail`).then((r) => r.json())).filter((m) => m.to.includes(email));
const resetLinks = async (email) => (await inbox(email)).flatMap((m) => m.links).filter((l) => l.includes("/reset?token="));
const tokenOf = (link) => new URL(link).searchParams.get("token");
// The reset email is sent just after the answer (so timing can't reveal which
// addresses have accounts): wait for it to arrive, or for a quiet moment when
// checking that nothing more was sent.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function linksAfter(email, want) {
  for (let i = 0; i < 50; i++) {
    const l = await resetLinks(email);
    if (l.length >= want) return l;
    await wait(100);
  }
  return resetLinks(email);
}
const settled = async (email) => (await wait(1500), resetLinks(email));

const email = `reset${Date.now()}@x.com`;
const laptop = client();
await post(laptop, "/api/auth/signup", { name: "Reset Person", email, password: "old-password1" });
const phone = client();
await post(phone, "/api/auth/signin", { email, password: "old-password1" });
ok("second device signed in", (await phone("/api/shoots")).status === 200);

// Asking for a link: same answer for real and unknown addresses.
const anon = client();
const r1 = await post(anon, "/api/auth/password/forgot", { email: email.toUpperCase() });
const r2 = await post(anon, "/api/auth/password/forgot", { email: `nobody${Date.now()}@x.com` });
ok("forgot: same answer for known and unknown email", r1.status === 200 && r2.status === 200 && r1.j.status === r2.j.status, `${r1.status} ${r2.status}`);
ok("forgot: rejects a malformed email", (await post(anon, "/api/auth/password/forgot", { email: "nope" })).status === 400);
const links = await linksAfter(email, 1);
ok("forgot: reset email sent", links.length === 1, `${links.length} link(s)`);
const token = tokenOf(links[0]);

// Rate limit: a second request within a minute sends nothing (but answers the same).
const r3 = await post(anon, "/api/auth/password/forgot", { email });
ok("forgot: second request within a minute sends no email", r3.status === 200 && (await settled(email)).length === 1);

// Demo account can't be reset.
await post(anon, "/api/auth/password/forgot", { email: "demo@keeperheadshots.com" });
ok("forgot: demo account gets no email", (await settled("demo@keeperheadshots.com")).length === 0);

// Bad links.
ok("reset: garbage token rejected", (await post(anon, "/api/auth/password/reset", { token: "usr_x.123.abc", password: "new-password1" })).status === 400);
const [uid, exp, sig] = token.split(".");
ok("reset: tampered expiry rejected", (await post(anon, "/api/auth/password/reset", { token: `${uid}.${Number(exp) + 1000}.${sig}`, password: "new-password1" })).status === 400);
ok("reset: short password rejected", (await post(anon, "/api/auth/password/reset", { token, password: "short" })).status === 400);

// The page checks its link on opening, without using it up.
ok("reset check: a bad link is refused up front", (await post(anon, "/api/auth/password/reset/check", { token: "usr_x.123.abc" })).status === 400);
const goodCheck = await post(anon, "/api/auth/password/reset/check", { token });
ok("reset check: a good link passes (and still works below)", goodCheck.status === 200);
ok("reset check: an account with a password is changing it, not setting a first one", goodCheck.j?.firstPassword === false, JSON.stringify(goodCheck.j));

// Two tabs submit the same link at once: exactly one wins.
const tabA = client(), tabB = client();
const [x, y] = await Promise.all([post(tabA, "/api/auth/password/reset", { token, password: "new-password1" }), post(tabB, "/api/auth/password/reset", { token, password: "other-password1" })]);
ok("reset: link works exactly once, even in parallel", [x.status, y.status].sort().join() === "200,400", `${x.status},${y.status}`);
ok("reset check: a used link is refused up front", (await post(anon, "/api/auth/password/reset/check", { token })).status === 400);
const winner = x.status === 200 ? { f: tabA, pw: "new-password1" } : { f: tabB, pw: "other-password1" };
ok("reset: signs this browser in", (await winner.f("/api/shoots")).status === 200);
ok("reset: link can't be reused later", (await post(anon, "/api/auth/password/reset", { token, password: "third-password1" })).status === 400);

// Old sessions are signed out; old password stops working, new one works.
ok("reset: other devices signed out", (await phone("/api/shoots")).status === 401 && (await laptop("/api/shoots")).status === 401);
ok("reset: old password no longer works", (await post(client(), "/api/auth/signin", { email, password: "old-password1" })).status === 401);
const fresh = client();
ok("reset: new password works", (await post(fresh, "/api/auth/signin", { email, password: winner.pw })).status === 200);

// Sign out everywhere: other sessions end, this one stays.
const other = client();
await post(other, "/api/auth/signin", { email, password: winner.pw });
ok("signout-all: needs a session", (await post(client(), "/api/auth/signout-all")).status === 401);
ok("signout-all: succeeds", (await post(fresh, "/api/auth/signout-all")).status === 200);
ok("signout-all: this device stays signed in", (await fresh("/api/shoots")).status === 200);
ok("signout-all: other devices signed out", (await other("/api/shoots")).status === 401 && (await winner.f("/api/shoots")).status === 401);

// Unconfirmed email becomes confirmed by a reset (the link came from the inbox).
const me = await fresh("/api/me");
ok("reset: confirms the email address", me.j?.user?.emailVerified === true);

// A reset whose write saved but reported a storage time-out (A20-2). Run on an
// in-process app with its own throwaway store, so the write can land and then
// throw StorageTimeoutError, as a slow Blob write does.
{
  const os = await import("node:os"), path = await import("node:path"), fsp = (await import("node:fs/promises")).default;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "keeper-reset-timeout-"));
  for (const key of Object.keys(process.env)) if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_|STORAGE_NAMESPACE$)/.test(key)) delete process.env[key];
  Object.assign(process.env, { DATA_DIR: dir, SESSION_SECRET: "reset-timeout-secret-reset-timeout", VERCEL: "1", NODE_ENV: "test" });
  const { default: app } = await import("../../server.js");
  const { StorageTimeoutError } = await import("../../lib/storage.js");
  const { users, id } = await import("../../lib/store.js");
  const { resetToken, hashPassword } = await import("../../lib/auth.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const L = `http://127.0.0.1:${server.address().port}`;
  const local = async (p, body) => {
    const r = await fetch(L + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json().catch(() => null), cookie: r.headers.get("set-cookie") || "" };
  };
  const slow = await users.create({ id: id("usr"), name: "Slow Reset", email: `slowreset${Date.now()}@x.com`, password: await hashPassword("old-password1"), emailVerified: true, createdAt: new Date().toISOString() });
  const slowToken = resetToken(slow);
  const record = path.join(dir, "users", "id", `${slow.id}.json`);
  const realRename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (to !== record) return realRename(from, to);
    fsp.rename = realRename;
    await realRename(from, to); // lands…
    throw new StorageTimeoutError("write", `users/id/${slow.id}.json`, 20000); // …but reports a time-out
  };
  let first;
  try {
    first = await local("/api/auth/password/reset", { token: slowToken, password: "slow-password1" });
  } finally {
    fsp.rename = realRename;
  }
  ok("reset that saved but timed out: answered as done, and signed in", first.status === 200 && first.j?.user?.id === slow.id && /ahg_session=/.test(first.cookie), `${first.status} ${JSON.stringify(first.j)}`);
  const retry = await local("/api/auth/password/reset", { token: slowToken, password: "slow-password1" });
  ok("reset that saved but timed out: a retry says the password was changed, not that the link isn't valid", retry.j?.code === "changed" && /password was/i.test(retry.j?.error || "") && !/isn't valid/.test(retry.j?.error || ""), `${retry.status} ${JSON.stringify(retry.j)}`);
  const reopened = await local("/api/auth/password/reset/check", { token: slowToken });
  ok("reset that saved but timed out: reopening the link says so too", reopened.j?.code === "changed", `${reopened.status} ${JSON.stringify(reopened.j)}`);
  ok("reset that saved but timed out: the new password works", (await local("/api/auth/signin", { email: slow.email, password: "slow-password1" })).status === 200);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5 });
}

const failed = results.filter(([, pass]) => !pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
