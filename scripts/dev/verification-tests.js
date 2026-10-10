// DEV/QA ONLY — concurrent resend requests against two independent app
// processes sharing a throwaway store and a local email-provider stand-in.
// No production credentials, emails, or test hooks in application code.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-verification-"));
for (const key of Object.keys(process.env)) {
  if (/^(BLOB_|BACKUP_|ANTHROPIC_|GEMINI_|RESEND_|META_|STRIPE_|GOOGLE_|TURNSTILE_|SMTP_|IMPROVMX_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  DATA_DIR: dir, SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
  VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "test",
});
const { users, id } = await import("../../lib/store.js");
const { setSession } = await import("../../lib/auth.js");
const attempts = [];
let delivery = "ok";
const provider = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  attempts.push(JSON.parse(body));
  // Let the other app process receive concurrent requests while this send
  // is pending. The reservation must already be persisted by then.
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (delivery === "disconnect") return res.destroy();
  res.writeHead(delivery === "reject" ? 503 : 200, { "content-type": "application/json" });
  res.end(JSON.stringify(delivery === "reject" ? { message: "Provider unavailable" } : { id: `mail-${attempts.length}` }));
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
process.env.RESEND_API_KEY = "re_local_test";
process.env.RESEND_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
const workers = [];
const start = (configured = true) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { default: app } = await import('./server.js');
    const server = app.listen(0, '127.0.0.1', () => process.send(server.address().port));
  `], {
    cwd: new URL("../../", import.meta.url),
    env: { ...process.env, RESEND_API_KEY: configured ? process.env.RESEND_API_KEY : "" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  workers.push(child);
  let output = "";
  child.stdout.on("data", (s) => { output += s; });
  child.stderr.on("data", (s) => { output += s; });
  const timer = setTimeout(() => reject(new Error(`App startup timed out: ${output}`)), 20_000);
  child.once("message", (port) => { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); });
  child.once("error", (err) => { clearTimeout(timer); reject(err); });
  child.once("exit", (code) => { clearTimeout(timer); if (code) reject(new Error(`App exited ${code}: ${output}`)); });
});
let passed = 0;
const pass = (name) => { passed++; console.log(`PASS ${name}`); };
const minute = 60_000, day = 24 * 60 * minute;
const account = async (verifySends = [], emailVerified = false) => {
  const uid = id("usr");
  const user = await users.create({ id: uid, name: "Verification QA", email: `${uid}@example.com`, emailVerified, verifySends, createdAt: new Date().toISOString() });
  let cookie;
  setSession({ cookie(name, value) { if (name === "ahg_session") cookie = `${name}=${value}`; } }, user);
  return { user, cookie };
};
const resend = async (base, a) => {
  const res = await fetch(base + "/api/auth/verify/resend", { method: "POST", headers: { cookie: a.cookie } });
  return { status: res.status, body: await res.json() };
};
const history = async (a) => (await users.byId(a.user.id)).verifySends;

try {
  const [one, two, noMail] = await Promise.all([start(), start(), start(false)]);
  const burst = (a) => Promise.all(Array.from({ length: 6 }, (_, i) => resend(i % 2 ? two : one, a)));

  const initial = Date.now() - 2 * minute;
  const a = await account([initial]);
  const before = attempts.length;
  const results = await burst(a);
  assert.equal(results.filter((r) => r.status === 200 && r.body.status === "sent").length, 1);
  assert.equal(results.filter((r) => r.status === 429).length, 5);
  assert.equal(attempts.length - before, 1);
  assert.equal((await history(a)).length, 2);
  assert.equal((await history(a))[0], initial);
  pass("six parallel requests across two processes send one email and preserve both timestamps");

  const fullHistory = Array.from({ length: 5 }, (_, i) => Date.now() - (i + 2) * minute);
  const full = await account(fullHistory);
  const fullBefore = attempts.length;
  assert.ok((await burst(full)).every((r) => r.status === 429));
  assert.equal(attempts.length, fullBefore);
  assert.deepEqual(await history(full), fullHistory);
  pass("the daily limit blocks every concurrent request without losing history");

  const last = await account(fullHistory.slice(0, 4));
  const lastBefore = attempts.length;
  assert.equal((await burst(last)).filter((r) => r.status === 200).length, 1);
  assert.equal(attempts.length - lastBefore, 1);
  assert.equal((await history(last)).length, 5);
  await users.update(last.user.id, (u) => { u.verifySends = u.verifySends.map((t) => t > Date.now() - minute ? t - 2 * minute : t); });
  assert.equal((await resend(two, last)).status, 429);
  assert.equal(attempts.length - lastBefore, 1);
  pass("concurrent requests cannot exceed the final daily allowance, even after cooldown");

  const old = Date.now() - day - minute, live = Date.now() - 2 * minute;
  const expired = await account([old, live]);
  assert.equal((await resend(one, expired)).status, 200);
  const kept = await history(expired);
  assert.equal(kept.length, 2);
  assert.equal(kept[0], live);
  pass("expired daily entries are pruned while live entries remain counted");

  const verified = await account([], true);
  const verifiedBefore = attempts.length;
  const already = await resend(two, verified);
  assert.equal(already.status, 200);
  assert.equal(already.body.status, "already");
  assert.equal(attempts.length, verifiedBefore);
  assert.deepEqual(await history(verified), []);
  pass("verified accounts do not send or reserve confirmation emails");

  const unconfigured = await account();
  const unconfiguredBefore = attempts.length;
  assert.equal((await resend(noMail, unconfigured)).status, 503);
  assert.equal(attempts.length, unconfiguredBefore);
  assert.deepEqual(await history(unconfigured), []);
  pass("missing email configuration consumes no allowance");

  delivery = "reject";
  const failed = await account([initial]);
  const failedBefore = attempts.length;
  const failure = await resend(one, failed);
  assert.equal(failure.status, 502);
  assert.match(failure.body.error, /couldn't send.*try again/i);
  assert.equal((await history(failed)).length, 2);
  assert.ok((await burst(failed)).every((r) => r.status === 429));
  assert.equal(attempts.length - failedBefore, 1);
  delivery = "ok";
  await users.update(failed.user.id, (u) => { u.verifySends = u.verifySends.map((t) => t - 2 * minute); });
  assert.equal((await resend(two, failed)).body.status, "sent");
  assert.equal((await history(failed)).length, 3);
  assert.equal(attempts.length - failedBefore, 2);
  pass("provider errors return a failure, retain the reservation, and permit recovery after cooldown");

  delivery = "disconnect";
  const uncertain = await account();
  const uncertainBefore = attempts.length;
  assert.equal((await resend(two, uncertain)).status, 502);
  assert.equal((await resend(one, uncertain)).status, 429);
  assert.equal(attempts.length - uncertainBefore, 1);
  assert.equal((await history(uncertain)).length, 1);
  pass("a lost provider response cannot refund a potentially delivered email");

  delivery = "ok";
  const [alice, bob] = await Promise.all([account(), account()]);
  const separateBefore = attempts.length;
  assert.ok((await Promise.all([resend(one, alice), resend(two, bob)])).every((r) => r.status === 200));
  assert.equal(attempts.length - separateBefore, 2);
  assert.equal((await history(alice)).length, 1);
  assert.equal((await history(bob)).length, 1);
  pass("different accounts retain independent email allowances");
  console.log(`${passed}/${passed} passed`);
} finally {
  await Promise.all(workers.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill();
  })));
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
}
