// DEV/QA ONLY — "Continue with Google" (lib/google.js, /api/auth/google*):
// the redirect to Google, the checks on the way back (state, PKCE, nonce,
// audience, expiry, confirmed email), new accounts, linking to an existing
// account, and an unconfirmed account being taken over by the inbox's owner.
// Run against a local server wired to scripts/dev/mock-ai.js, with
// GOOGLE_CLIENT_ID/SECRET set and GOOGLE_AUTH_URL/GOOGLE_TOKEN_URL pointing at
// the mock (see scripts/dev/ci.sh):
//   node scripts/dev/google-tests.js
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const run = Date.now().toString(36);

function client() {
  const jar = new Map();
  const f = async (p, o = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(p.startsWith("http") ? p : B + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
    for (const sc of r.headers.getSetCookie()) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      const [k, v] = [kv.slice(0, i), kv.slice(i + 1)];
      if (!v || /expires=Thu, 01 Jan 1970/i.test(sc)) jar.delete(k);
      else jar.set(k, v);
    }
    let j = null;
    try { j = await r.clone().json(); } catch {}
    return { status: r.status, j, r, location: r.headers.get("location"), setCookie: r.headers.getSetCookie() };
  };
  f.jar = jar;
  return f;
}
const code = (claims) => Buffer.from(JSON.stringify(claims)).toString("base64url");
// Starts the flow and returns what Google would hand back for these claims.
async function google(f, claims, { mode = "signin", next } = {}) {
  const start = await f(`/api/auth/google?mode=${mode}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  const to = new URL(start.location);
  const q = to.searchParams;
  const back = (extra = {}) => `/api/auth/google/callback?${new URLSearchParams({ state: q.get("state"), code: code({ nonce: q.get("nonce"), challenge: q.get("code_challenge"), ...claims }), ...extra })}`;
  return { start, to, back };
}
const mails = () => fetch(`${M}/mock-mail`).then((r) => r.json());
const metaEvents = () => fetch(`${M}/mock-meta`).then((r) => r.json());
const verifyToken = async (email) => new URL((await mails()).filter((m) => m.to.includes(email)).flatMap((m) => m.links).findLast((l) => l.includes("/verify?token="))).searchParams.get("token");

// 1. Advertised, and the redirect to Google carries everything it needs.
{
  const f = client();
  const me = await f("/api/me");
  ok("/api/me says Google sign-in is on", me.j.google === true);
  const { start, to } = await google(f, {}, { mode: "signup", next: "/app/new" });
  const q = to.searchParams;
  ok("redirects to Google's sign-in page", start.status === 302 && to.href.startsWith(`${M}/google/auth`), start.location);
  ok("asks for openid, email and profile", q.get("scope") === "openid email profile" && q.get("response_type") === "code");
  ok("sends our client id and callback", q.get("client_id") === "ci-client.apps.googleusercontent.com" && q.get("redirect_uri") === `${B}/api/auth/google/callback`);
  ok("uses PKCE (S256), a state and a nonce", q.get("code_challenge_method") === "S256" && q.get("code_challenge")?.length >= 43 && q.get("state")?.length >= 20 && q.get("nonce")?.length >= 20);
  const sc = start.setCookie.find((c) => c.startsWith("kh_google="));
  ok("the flow cookie is HttpOnly, Lax and scoped to the callback path", /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Path=\/api\/auth\/google/.test(sc), sc);
  ok("the redirect isn't cached", /no-store/.test(start.r.headers.get("cache-control") || ""));
}

// 2. A new account: confirmed straight away, no password, Pixel/CAPI event.
const newEmail = `gina-${run}@example.com`;
let gina;
{
  const f = client();
  const { back } = await google(f, { sub: `g-gina-${run}`, email: newEmail.toUpperCase(), name: "Gina Google", given_name: "Gina" }, { mode: "signup" });
  const cb = await f(back());
  ok("new account lands on /app/new with the welcome marker", cb.status === 302 && cb.location === "/app/new?auth=google-new", cb.location);
  ok("the flow cookie is cleared", !f.jar.has("kh_google"));
  const me = (await f("/api/me")).j.user;
  gina = me;
  ok("signed in as the Google account (address lowercased)", me?.email === newEmail && me?.name === "Gina Google");
  ok("the address counts as confirmed", me?.emailVerified === true && me?.plan && !me.plan.needsEmail, JSON.stringify(me?.plan));
  ok("no password, linked to Google", me?.hasPassword === false && me?.google === true);
  ok("no confirmation email was sent", !(await mails()).some((m) => m.to.includes(newEmail)));
  await new Promise((r) => setTimeout(r, 300));
  ok("Meta CompleteRegistration sent with the account's event id", (await metaEvents()).some((e) => e.event_name === "CompleteRegistration" && e.event_id === `reg_${me.id}`));
  const pw = await client()("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: newEmail, password: "anything-at-all" }) });
  ok("password sign-in doesn't work for a Google-only account", pw.status === 401);
  // The server compares against a dummy hash when an account has no password
  // (for even timing); that hash's own password must not get in either.
  const dummy = await client()("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: newEmail, password: "not-a-real-password" }) });
  ok("…not even with the dummy hash's password", dummy.status === 401, String(dummy.status));
  // Signing in again with Google: same account, plain welcome back.
  const g = client();
  const again = await google(g, { sub: `g-gina-${run}`, email: newEmail, name: "Gina Google" });
  const cb2 = await g(again.back());
  ok("returning Google sign-in lands on /app", cb2.location === "/app?auth=google", cb2.location);
  ok("…in the same account", (await g("/api/me")).j.user?.id === gina.id);
}

// 3. The checks on the way back.
{
  const claims = { sub: `g-x-${run}`, email: `x-${run}@example.com`, name: "Xan Test" };
  const f = client();
  const { back } = await google(f, claims, { mode: "signup" });
  const noCookie = await client()(back());
  ok("without the flow cookie: back to sign-in, 'expired'", noCookie.location === "/signin?google=expired", noCookie.location);
  const badState = await f(back().replace(/state=[^&]+/, "state=forged-state-value-forged"));
  ok("with a different state: 'expired' (back to sign-up)", badState.location === "/signup?google=expired", badState.location);

  const cases = [
    ["a different nonce", { nonce: "not-the-nonce" }],
    ["another app's audience", { aud: "someone-else.apps.googleusercontent.com" }],
    ["an expired ID token", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ["an unconfirmed Google address", { email_verified: false }],
    ["a different issuer", { iss: "https://evil.example.com" }],
    ["the wrong PKCE challenge", { challenge: "A".repeat(43) }],
    ["the demo account's address", { email: "demo@keeperheadshots.com" }],
  ];
  for (const [label, extra] of cases) {
    const g = client();
    const { back: b } = await google(g, { ...claims, ...extra });
    const cb = await g(b());
    ok(`refused: ${label}`, cb.location === "/signin?google=failed" && !(await g("/api/me")).j.user, cb.location);
  }
  const g = client();
  const { back: b } = await google(g, claims, { mode: "signup", next: "/app/new" });
  const cancel = await g(`/api/auth/google/callback?error=access_denied&state=x`);
  ok("Cancel on Google's page: back to sign-up with the destination kept", cancel.location === "/signup?google=cancelled&next=%2Fapp%2Fnew", cancel.location);
  ok("nobody was signed in by any of that", !(await g("/api/me")).j.user);
  // Only /app… and /join can be the destination.
  const h = client();
  const evil = await google(h, { ...claims, sub: `g-y-${run}`, email: `y-${run}@example.com` }, { next: "https://evil.example.com/" });
  const cb = await h(evil.back());
  ok("an outside 'next' is ignored", cb.location === "/app/new?auth=google-new", cb.location);
  const k = client();
  const deep = await google(k, { ...claims, sub: `g-y-${run}`, email: `y-${run}@example.com` }, { next: "/app/account" });
  ok("an /app 'next' is honored", (await k(deep.back())).location === "/app/account?auth=google", "");
}

// 3b. Already linked to one Google account: another Google account with the
// same address (a reassigned work address) doesn't get in.
{
  const f = client();
  const other = await google(f, { sub: `g-other-${run}`, email: newEmail, name: "Someone Else" });
  const cb = await f(other.back());
  ok("a second Google account with a linked address is refused", cb.location === "/signin?google=failed" && !(await f("/api/me")).j.user, cb.location);
}

// 3c. A forged flow cookie can't send the person off the site.
{
  const f = client();
  const { back } = await google(f, { sub: `g-gina-${run}`, email: newEmail, name: "Gina Google" });
  const flow = JSON.parse(Buffer.from(f.jar.get("kh_google"), "base64url").toString());
  f.jar.set("kh_google", Buffer.from(JSON.stringify({ ...flow, next: "https://evil.example/x" })).toString("base64url"));
  const cb = await f(back());
  ok("a forged 'next' in the flow cookie is ignored", cb.location === "/app?auth=google", cb.location);
}

// 4. An existing, confirmed password account is linked. From another browser
// (not the one that made it), a password someone else may have set goes, with
// every other session; from the browser that made it, nothing changes.
{
  const email = `pat-${run}@example.com`;
  const f = client();
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Pat Lee", email, password: "password123" }) });
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email) }) });
  const before = (await f("/api/me")).j.user;
  const g = client();
  const { back } = await google(g, { sub: `g-pat-${run}`, email, name: "Patricia Lee" });
  const cb = await g(back());
  const me = (await g("/api/me")).j.user;
  ok("existing confirmed account from another browser: signed in, told why", cb.location === "/app?auth=google-secured" && me?.id === before.id, cb.location);
  ok("…now linked, the old password removed, name unchanged", me.google === true && me.hasPassword === false && me.name === "Pat Lee");
  ok("…other sessions are signed out", !(await f("/api/me")).j.user);
  const pw = await client()("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
  ok("…and the old password no longer signs in", pw.status === 401);

  const email2 = `pam-${run}@example.com`;
  const h = client();
  await h("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Pam Lee", email: email2, password: "password123" }) });
  await h("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email2) }) });
  const same = await google(h, { sub: `g-pam-${run}`, email: email2, name: "Pam Lee" });
  const cb2 = await h(same.back());
  const me2 = (await h("/api/me")).j.user;
  ok("from the browser that made the account: plain sign-in, password kept", cb2.location === "/app?auth=google" && me2?.google === true && me2?.hasPassword === true, cb2.location);
}

// 5. An unconfirmed account made by someone else with this address: the
// inbox's owner takes it over; the stranger's session and password stop working.
{
  const email = `victim-${run}@example.com`;
  const stranger = client();
  const up = await stranger("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Not Them", email, password: "stranger-password" }) });
  ok("a stranger signs up with someone else's address (unconfirmed)", up.status === 201 && up.j.user.emailVerified === false);
  const owner = client();
  const { back } = await google(owner, { sub: `g-victim-${run}`, email, name: "Real Owner" });
  const cb = await owner(back());
  const me = (await owner("/api/me")).j.user;
  ok("the owner signs in with Google: confirmed, and told the password went", cb.location === "/app?auth=google-secured" && me?.emailVerified === true, cb.location);
  ok("…the stranger's password is gone", me.hasPassword === false);
  ok("…the stranger's session ended", !(await stranger("/api/me")).j.user);
  const pw = await client()("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "stranger-password" }) });
  ok("…and their password no longer signs in", pw.status === 401);
}

// 5b. An unconfirmed account, signed in with Google from the browser that made
// it: the same person, so the password and other sessions are kept.
{
  const email = `samebrowser-${run}@example.com`;
  const h = client();
  const up = await h("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Sam Same", email, password: "same-password" }) });
  ok("an unconfirmed account made in this browser", up.status === 201 && up.j.user.emailVerified === false);
  const other = client();
  await other("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "same-password" }) });
  const { back } = await google(h, { sub: `g-same-${run}`, email, name: "Sam Same" });
  const cb = await h(back());
  const me = (await h("/api/me")).j.user;
  ok("…Google from the same browser confirms it and keeps the password", cb.location === "/app?auth=google-verified" && me?.emailVerified === true && me?.hasPassword === true, cb.location);
  ok("…and the person's other session", !!(await other("/api/me")).j.user);
}

// 6. Deleting a Google-only account: signing in with Google again, in this
// session and in the last few minutes, confirms (typing the email no longer does).
{
  const f = client();
  const sub = `g-del-${run}`, email = `del-${run}@example.com`;
  const { back } = await google(f, { sub, email, name: "Dee Lete" });
  await f(back());
  const me = (await f("/api/me")).j.user;
  await client()("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) });
  await new Promise((r) => setTimeout(r, 300));
  const resetLink = (await mails()).filter((m) => m.to.includes(email)).flatMap((m) => m.links).findLast((l) => l.includes("/reset"));
  const chk = await client()("/api/auth/password/reset/check", { method: "POST", body: JSON.stringify({ token: new URL(resetLink).searchParams.get("token") }) });
  ok("a reset link for a Google-only account is for a first password", chk.status === 200 && chk.j?.firstPassword === true, JSON.stringify(chk.j));
  const typed = await f("/api/account/delete", { method: "POST", body: JSON.stringify({ email }) });
  ok("typing the account's email no longer deletes it", typed.status === 401 && typed.j?.code === "reauth_needed" && !!(await f("/api/me")).j.user, String(typed.status));
  const out = await client()("/api/auth/google?mode=reauth");
  ok("confirming while signed out goes back to the account page, refused", out.status === 302 && out.location === "/app/account?reauth=failed", out.location);
  const other = await google(f, { sub: `g-someone-${run}`, email: `someone-${run}@example.com` }, { mode: "reauth" });
  ok("the confirmation goes to Google", other.start.status === 302 && other.to.href.startsWith(`${M}/google/auth`));
  ok("…asking Google to check again (max_age=0)", other.to.searchParams.get("max_age") === "0");
  ok("…which a plain sign-in doesn't ask", !(await google(client(), {})).to.searchParams.has("max_age"));
  const wrong = await f(other.back());
  ok("another Google account doesn't confirm", wrong.location === "/app/account?reauth=failed" && !f.jar.has("kh_reauth"), wrong.location);
  ok("…and doesn't switch this browser to that account", (await f("/api/me")).j.user?.id === me.id);
  ok("…so deleting is still refused", (await f("/api/account/delete", { method: "POST", body: "{}" })).status === 401);
  const cancelled = await google(f, { sub, email }, { mode: "reauth" });
  const c = await f(`/api/auth/google/callback?error=access_denied&state=${cancelled.to.searchParams.get("state")}`);
  ok("cancelling on Google's page comes back to the account page", c.location === "/app/account?reauth=cancelled", c.location);
  const stale = await google(f, { sub, email, auth_time: Math.floor(Date.now() / 1000) - 3600 }, { mode: "reauth" });
  const st = await f(stale.back());
  ok("a Google sign-in from an hour ago doesn't confirm", st.location === "/app/account?reauth=failed" && !f.jar.has("kh_reauth"), st.location);
  const right = await google(f, { sub, email, auth_time: Math.floor(Date.now() / 1000) - 5 }, { mode: "reauth" });
  const cb = await f(right.back());
  const sc = cb.setCookie.find((x) => x.startsWith("kh_reauth="));
  ok("the account's own Google account confirms", cb.location === "/app/account?reauth=ok" && !!sc, cb.location);
  ok("…with a short-lived, HttpOnly, Strict cookie only the delete route sees", /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && /Path=\/api\/account\/delete/.test(sc) && /Max-Age=300/.test(sc), sc);
  ok("…without changing the account or signing in afresh", (await f("/api/me")).j.user?.id === me.id);
  // Another session of the same account can't borrow the confirmation.
  const g = client();
  await g((await google(g, { sub, email })).back());
  g.jar.set("kh_reauth", f.jar.get("kh_reauth"));
  ok("the confirmation is tied to the session that got it", (await g("/api/account/delete", { method: "POST", body: "{}" })).status === 401);
  const del = await f("/api/account/delete", { method: "POST", body: "{}" });
  ok("then deleting works", del.status === 200 && !(await f("/api/me")).j.user && !f.jar.has("kh_reauth"), String(del.status));
}

// 6b. An account with a password confirms with it, not Google.
{
  const f = client();
  const email = `pw-${run}@example.com`;
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Pat Word", email, password: "password123" }) });
  const r = await f("/api/auth/google?mode=reauth");
  ok("a password account can't use the Google confirmation", r.location === "/app/account?reauth=failed", r.location);
}

// 7. A name that isn't a name falls back to the given name, then the address.
{
  const f = client();
  const { back } = await google(f, { sub: `g-n-${run}`, email: `sam.k-${run}@example.com`, name: "Visit www.spam.example", given_name: "Sam" });
  await f(back());
  ok("a link in the name falls back to the given name", (await f("/api/me")).j.user?.name === "Sam");
  const g = client();
  const { back: b } = await google(g, { sub: `g-m-${run}`, email: `jo.ann-${run}@example.com`, name: "<b>", given_name: "" });
  await g(b());
  ok("…and then to the address (dots as spaces)", (await g("/api/me")).j.user?.name === `jo ann-${run}`, (await g("/api/me")).j.user?.name);
}

const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
