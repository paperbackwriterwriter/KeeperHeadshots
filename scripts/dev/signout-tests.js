// DEV/QA ONLY — isolated sign-out API regression tests, including a failed
// revocation write. Uses a throwaway filesystem store and an ephemeral port;
// no external services or production test hooks are involved.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-signout-"));
for (const key of Object.keys(process.env)) {
  if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_)/.test(key)) delete process.env[key];
}
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
process.env.VERCEL = "1"; // Import the app without starting its normal listener.
process.env.VERCEL_ENV = "preview";
process.env.NODE_ENV = "test";

const { default: app } = await import("../../server.js");
const { users, id } = await import("../../lib/store.js");
const { setSession } = await import("../../lib/auth.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const BASE = `http://127.0.0.1:${server.address().port}`;
const originalUpdate = users.update;
let failRevocation = false;
let passed = 0;
const pass = (name) => { passed++; console.log(`PASS ${name}`); };

try {
  const user = await users.create({ id: id("usr"), name: "Sign-out QA", email: "signout@example.com", emailVerified: true, createdAt: new Date().toISOString() });
  const session = () => {
    let cookie;
    setSession({ cookie(name, value) { if (name === "ahg_session") cookie = `${name}=${value}`; } }, user);
    return cookie;
  };
  const one = session(), other = session();
  const me = (cookie) => fetch(BASE + "/api/me", { headers: { cookie } }).then((r) => r.json()).then((r) => r.user);
  const signout = (cookie = "") => fetch(BASE + "/api/auth/signout", { method: "POST", headers: { cookie } });
  users.update = (uid, fn) => {
    if (failRevocation && uid === user.id) throw new Error("Simulated revocation storage failure");
    return originalUpdate(uid, fn);
  };

  failRevocation = true;
  const failed = await signout(one);
  assert.equal(failed.status, 503);
  const error = await failed.json();
  assert.match(error.error, /Sign-out.*try again/i);
  assert.notEqual(error.ok, true);
  assert.equal(failed.headers.get("set-cookie"), null);
  assert.equal((await me(one)).id, user.id);
  assert.equal((await me(other)).id, user.id);
  pass("a failed revocation returns a retryable error without falsely clearing the session");

  failRevocation = false;
  const retried = await signout(one);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { ok: true });
  assert.match(retried.headers.get("set-cookie"), /ahg_session=;.*Expires=/i);
  assert.equal(await me(one), null);
  assert.equal((await me(other)).id, user.id);
  pass("retry succeeds, revokes copied cookies, and preserves the other device's session");

  const repeated = await signout(one);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), { ok: true });
  assert.equal(await me(one), null);
  pass("repeating a completed sign-out remains safe");

  const anonymous = await signout();
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), { ok: true });
  pass("an anonymous visitor can safely clear a session cookie");
  console.log(`${passed}/${passed} passed`);
} finally {
  users.update = originalUpdate;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await fs.rm(dir, { recursive: true, force: true });
}
