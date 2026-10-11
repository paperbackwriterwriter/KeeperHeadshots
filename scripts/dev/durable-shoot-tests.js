// DEV/QA ONLY — isolated providers and two workers sharing a throwaway store.
// Observe storage, never poll the progress API, to prove browser independence.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-durable-"));
process.env.DATA_DIR = path.join(dir, "data");
for (const k of ["VERCEL", "VERCEL_ENV", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "STORAGE_NAMESPACE"]) delete process.env[k];
const { shoots, users, saveMedia, writeMedia, id } = await import("../../lib/store.js");
const storage = await import("../../lib/storage.js");
const { prepareShootJob, discardShootJob, processShootJob, ShootPending } = await import("../../lib/shoot-jobs.js");
const env = { ...process.env, DATA_DIR: process.env.DATA_DIR, SESSION_SECRET: "durable-tests-secret-durable-tests-secret", ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: "http://localhost:4015", GEMINI_API_KEY: "test", GEMINI_BASE_URL: "http://localhost:4015", RESEND_API_KEY: "re_test", RESEND_BASE_URL: "http://localhost:4015", OWNER_EMAILS: "durable-owner@example.com", RENDER_SLOTS: "2" };
const children = new Set();
const logs = [];
let broker;
function launch(args, vars, name) {
  const out = path.join(dir, name + ".log");
  const log = fs.open(out, "a");
  logs.push(log);
  const child = spawn(process.execPath, args, { env: { ...env, ...vars }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.stdout.on("data", async (b) => (await log).appendFile(b));
  child.stderr.on("data", async (b) => (await log).appendFile(b));
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGKILL"); });
  children.delete(child);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const r = await fn(); if (r) return r; await pause(100); }
  throw new Error("Timed out waiting for durable worker");
}
const ready = (port) => until(async () => fetch(`http://localhost:${port}/api/version`).then((r) => r.ok, () => false), 30_000);
let count = 0;
function pass(name) { count++; console.log("PASS", name); }
function client() {
  let cookie = "";
  return async (url, body, { method = body === undefined ? "GET" : "POST", port = 3215 } = {}) => {
    const r = await fetch(`http://localhost:${port}${url}`, { method, headers: { "content-type": "application/json", cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { status: r.status, j: await r.json() };
  };
}
async function account(email) {
  const f = client();
  const up = await f("/api/auth/signup", { name: "Durable Test", email, password: "password123" });
  assert.equal(up.status, 201);
  const mail = await fetch("http://localhost:4015/mock-mail").then((r) => r.json());
  const link = mail.filter((m) => m.to.includes(email)).flatMap((m) => m.links).find((l) => l.includes("/verify?token="));
  assert.equal((await f("/api/auth/verify", { token: new URL(link).searchParams.get("token") })).status, 200);
  return { f, uid: up.j.user.id, email };
}
const photo = "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("durable"))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
async function draft(a) {
  const r = await a.f("/api/shoots", {}); assert.equal(r.status, 201);
  const sid = r.j.shoot.id;
  for (let i = 0; i < 3; i++) assert.equal((await a.f(`/api/shoots/${sid}/selfies`, { photo })).status, 201);
  return sid;
}
async function checked(a) { const sid = await draft(a); assert.equal((await a.f(`/api/shoots/${sid}/check`, {})).status, 200); return sid; }
const looks = [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "library", outfit: "camel-knit" }];
async function erased(a, sid) {
  assert.equal(await storage.getJSON(`shoots/${sid}.json`), null);
  assert.deepEqual(await storage.list(`media/${sid}/`), []);
  assert.deepEqual(await storage.list(`shots/${sid}/`), []);
  assert.deepEqual(await storage.list(`idx/${a.uid}/`), []);
  assert.deepEqual(await storage.list(`jobs/shoots/${sid}/`), []);
  assert.equal(await users.byId(a.uid), null);
}

try {
  launch(["scripts/dev/mock-ai.js"], { MOCK_PORT: "4015", MOCK_SMTP_PORT: "2535", MOCK_DELAY_MS: "1200", MOCK_QA_FAIL: "none" }, "mock");
  let s1 = launch(["server.js"], { PORT: "3215" }, "server-1");
  let s2 = launch(["server.js"], { PORT: "3216" }, "server-2");
  await Promise.all([ready(3215), ready(3216)]);
  const owner = await account("durable-owner@example.com");
  const sid = await checked(owner);
  assert.equal((await owner.f(`/api/shoots/${sid}/generate`, { looks })).status, 202);
  const finished = await until(async () => { const m = await shoots.get(sid); return m?.status === "done" && m; });
  assert.equal(finished.shots.filter((s) => s.status === "done").length, 4);
  assert.equal(Object.keys(finished.review.shots).length, 4);
  pass("all batches and grading finish with zero browser progress polls");
  const renderLog = (await fs.readFile(path.join(dir, "mock.log"), "utf8")).split("\n").filter((l) => /generateContent/.test(l) && /refs=[2-9]/.test(l));
  assert.equal(renderLog.length, 4);
  assert.ok(Math.max(...renderLog.map((l) => Number(/renders=(\d+)/.exec(l)?.[1] || 0))) <= 2);
  pass("two workers render each frame once within the global slot limit");
  await until(async () => !(await storage.list(`jobs/shoots/${sid}/`)).length);
  const newJob = await prepareShootJob(sid);
  await assert.rejects(processShootJob({ sid, jobId: newJob }), ShootPending);
  assert.ok(await storage.getJSON(`jobs/shoots/${sid}/${newJob}.json`));
  await discardShootJob(sid, newJob);
  pass("an early retry or regrade delivery waits for its new plan commit");
  const { startReview } = await import("../../lib/pipeline.js");
  await assert.rejects(startReview(sid, () => { throw new Error("Regrade limit"); }), /Regrade limit/);
  assert.deepEqual(await storage.list(`jobs/shoots/${sid}/`), []);
  pass("a refused regrade discards its uncommitted durable delivery");

  // A Vercel publisher without queue credentials must fail before paid work
  // commits; use the real SDK failure path, never a mocked pipeline function.
  const failing = await account("publish-failure@example.com");
  const failSid = await checked(failing);
  const prod = launch(["--input-type=module", "-e", 'const {default:app}=await import("./server.js"); app.listen(3217);'], { VERCEL: "1", PORT: "3217" }, "publisher-failure");
  await ready(3217);
  const failure = await failing.f(`/api/shoots/${failSid}/generate`, { looks }, { port: 3217 });
  assert.equal(failure.status, 503);
  assert.equal((await shoots.getMeta(failSid)).status, "checked");
  assert.equal((await failing.f("/api/me")).j.user.plan.freeShootAvailable, true);
  assert.deepEqual(await storage.list(`jobs/shoots/${failSid}/`), []);
  await stop(prod);
  pass("failed durable publish refunds the shoot and leaves no active plan");

  const checking = await account("delete-checking@example.com");
  const checkSid = await draft(checking);
  const checkRequest = checking.f(`/api/shoots/${checkSid}/check`, {});
  await until(async () => (await storage.getJSON(`shoots/${checkSid}.json`))?.status === "checking");
  assert.equal((await checking.f("/api/account/delete", { password: "password123" })).status, 200);
  await checkRequest;
  await erased(checking, checkSid);
  pass("account deletion during selfie checking removes the account and photos");

  const rendering = await account("delete-rendering@example.com");
  const renderSid = await checked(rendering);
  assert.equal((await rendering.f(`/api/shoots/${renderSid}/generate`, { looks })).status, 202);
  await until(async () => (await shoots.get(renderSid))?.shots.some((s) => s.stage === "render"));
  assert.equal((await rendering.f("/api/account/delete", { password: "wrong" })).status, 401);
  assert.ok(await shoots.getMeta(renderSid));
  pass("wrong-password deletion leaves the active shoot intact");
  const beforeDelete = (await fs.readFile(path.join(dir, "mock.log"), "utf8")).length;
  assert.equal((await rendering.f("/api/account/delete", { password: "password123" })).status, 200);
  await pause(5500);
  await erased(rendering, renderSid);
  const late = (await fs.readFile(path.join(dir, "mock.log"), "utf8")).slice(beforeDelete);
  assert.ok(!late.includes("POST /v1/messages"));
  pass("deletion during rendering prevents late QA, retakes, and photo restoration");
  await assert.rejects(saveMedia(renderSid, Buffer.from("late")), { status: 410 });
  await assert.rejects(writeMedia(`${renderSid}/late.jpg`, Buffer.from("late")), { status: 410 });
  assert.equal(await shoots.claimShot(renderSid, "shot_late", "claim_late", new Date().toISOString()), false);
  await assert.rejects(shoots.create({ id: id("sht"), userId: rendering.uid, selfies: [], shots: [] }), { status: 410 });
  await assert.rejects(users.update(rendering.uid, (u) => { u.credits = 10; }), { status: 410 });
  await erased(rendering, renderSid);
  pass("stale uploads, downloads, claims, and account writes cannot resurrect erased data");

  const reviewing = await account("delete-reviewing@example.com");
  const reviewSid = await checked(reviewing);
  assert.equal((await reviewing.f(`/api/shoots/${reviewSid}/generate`, { looks: looks.slice(0, 1) })).status, 202);
  await until(async () => (await shoots.getMeta(reviewSid))?.reviewWorkerAt);
  assert.equal((await reviewing.f("/api/account/delete", { password: "password123" })).status, 200);
  await pause(3000);
  await erased(reviewing, reviewSid);
  const mail = await fetch("http://localhost:4015/mock-mail").then((r) => r.json());
  assert.ok(!mail.some((m) => m.to.includes(reviewing.email) && /headshots.*ready/i.test(m.subject)));
  pass("deletion during grading suppresses the ready email and late review writes");

  // Pause actual filesystem I/O immediately before rename. Erasure sweeps
  // first, then the late writer runs: the post-write barrier must clean it.
  for (const kind of ["photo", "account", "index"]) {
    const u = { id: id("usr"), email: `io-${kind}@example.com`, usage: {} };
    await users.create(u);
    const m = { id: id("sht"), userId: u.id, status: "draft", createdAt: new Date().toISOString(), selfies: [], shots: [] };
    if (kind !== "index") await shoots.create(m);
    const target = kind === "photo" ? `media/${m.id}/race.jpg` : kind === "account" ? `users/id/${u.id}.json` : `idx/${u.id}/${m.id}`;
    let release, entered;
    const gate = new Promise((r) => { release = r; });
    const hit = new Promise((r) => { entered = r; });
    const rename = fs.rename;
    fs.rename = async (from, to) => { if (to === path.join(env.DATA_DIR, target)) { entered(); await gate; } return rename(from, to); };
    let late;
    try {
      late = kind === "photo" ? writeMedia(`${m.id}/race.jpg`, Buffer.from("late photo")) : kind === "account" ? users.update(u.id, (x) => { x.credits = 3; }) : shoots.create(m);
      await hit;
      await users.remove(u);
      release();
      await assert.rejects(late, { status: 410 });
    } finally { release(); fs.rename = rename; }
    await erased({ uid: u.id }, m.id);
    pass(`overlapping ${kind} storage write removes its late object after erasure`);
  }

  const deleteSid = await checked(owner);
  assert.equal((await owner.f(`/api/shoots/${deleteSid}/generate`, { looks })).status, 202);
  await until(async () => (await shoots.get(deleteSid))?.shots.some((s) => s.stage === "render"));
  assert.equal((await owner.f(`/api/shoots/${deleteSid}`, undefined, { method: "DELETE" })).status, 200);
  await pause(5000);
  assert.equal(await shoots.get(deleteSid), null);
  assert.deepEqual(await storage.list(`media/${deleteSid}/`), []);
  assert.ok(await users.byId(owner.uid));
  pass("deleting a developing shoot cancels it without deleting its owner");

  const restartSid = await checked(owner);
  await Promise.all([stop(s1), stop(s2)]);
  const { startGeneration } = await import("../../lib/pipeline.js");
  const { lookFor } = await import("../../public/js/shared/catalog.js");
  await startGeneration(await shoots.getMeta(restartSid), looks.map((l) => lookFor(l.backdrop, l.outfit)));
  assert.equal((await shoots.getMeta(restartSid)).status, "generating");
  s1 = launch(["server.js"], { PORT: "3215" }, "server-restarted");
  await ready(3215);
  await until(async () => (await shoots.getMeta(restartSid))?.status === "done");
  pass("a fresh server resumes a persisted job without any browser request");
  // Exercise the real Queue SDK and Express CloudEvent callback against a
  // test broker. Stop all plain-Node workers so only delivered messages can
  // advance this shoot. The broker stays alive while the app is restarted.
  const cloudSid = await checked(owner);
  await stop(s1);
  const messages = [], directives = [];
  broker = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    if (req.headers.authorization !== "Bearer queue-test-token") { res.writeHead(401).end(); return; }
    const body = raw ? JSON.parse(raw) : null;
    if (req.method === "POST" && req.url === "/api/v3/topic/keeper-shoots") {
      messages.push({ body, headers: req.headers });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ messageId: "test-message" }));
    } else if (["PATCH", "DELETE"].includes(req.method)) {
      directives.push({ method: req.method, body });
      res.writeHead(200).end();
    } else res.writeHead(404).end();
  });
  await new Promise((resolve) => broker.listen(4016, resolve));
  const cloudVars = { VERCEL: "1", PORT: "3218", NODE_ENV: "development", VERCEL_CLI_VERSION: "59.26.0", VERCEL_QUEUE_BASE_URL: "http://localhost:4016", VERCEL_QUEUE_TOKEN: "queue-test-token" };
  const cloudArgs = ["--input-type=module", "-e", 'const {default:app}=await import("./server.js"); app.listen(3218);'];
  let cloud = launch(cloudArgs, cloudVars, "queue-callback");
  await ready(3218);
  assert.equal((await owner.f(`/api/shoots/${cloudSid}/generate`, { looks }, { port: 3218 })).status, 202);
  assert.equal(messages.length, 1);
  assert.deepEqual(Object.keys(messages[0].body).sort(), ["jobId", "sid"]);
  pass("the production publisher uses the Queue SDK and sends only random IDs");
  async function deliver(deliveryCount, index = 0) {
    const response = await fetch("http://localhost:3218/", { method: "POST", headers: {
      "content-type": "application/json", "ce-type": "com.vercel.queue.v2beta",
      "ce-vqsqueuename": "keeper-shoots", "ce-vqsconsumergroup": "server", "ce-vqsmessageid": "test-message",
      "ce-vqsreceipthandle": "test-receipt", "ce-vqsdeliverycount": String(deliveryCount), "ce-vqsregion": "iad1",
    }, body: JSON.stringify(messages[index].body) });
    assert.equal(response.status, 200, await response.text());
  }
  await deliver(1);
  const batch = await shoots.get(cloudSid);
  assert.equal(batch.shots.filter((s) => s.status === "done").length, 2);
  assert.ok(directives.some((d) => d.method === "PATCH" && d.body.visibilityTimeoutSeconds === 5));
  assert.ok(!directives.some((d) => d.method === "DELETE"));
  pass("the callback awaits its frame batch and requests durable redelivery");
  await stop(cloud);
  cloud = launch(cloudArgs, cloudVars, "queue-callback-restarted");
  await ready(3218);
  for (let delivery = 2; delivery <= 5 && (await shoots.getMeta(cloudSid)).status !== "done"; delivery++) await deliver(delivery);
  const cloudDone = await shoots.get(cloudSid);
  assert.equal(cloudDone.status, "done");
  assert.equal(cloudDone.shots.filter((s) => s.status === "done").length, 4);
  assert.equal(directives.filter((d) => d.method === "DELETE").length, 1);
  pass("Queue redelivery completes all frames and grading after an app restart");
  const callsBeforeDuplicate = (await fs.readFile(path.join(dir, "mock.log"), "utf8")).length;
  await deliver(6);
  assert.equal((await fs.readFile(path.join(dir, "mock.log"), "utf8")).length, callsBeforeDuplicate);
  pass("a duplicate completed Queue delivery does no additional AI work");
  // The metadata's plan is a pre-upgrade live shoot, with no durable job.
  const legacySid = id("sht");
  const { planShots } = await import("../../lib/pipeline.js");
  const source = await shoots.getMeta(cloudSid);
  await shoots.create({ ...source, id: legacySid, status: "generating", jobId: undefined, review: null, reviewStartedAt: null, reviewWorkerAt: null, readyEmailedAt: null, shots: planShots(looks) });
  // Reuse the source references only for this isolated fixture; remove the
  // fixture's metadata afterwards, never its source shoot's shared photos.
  const upgraded = await owner.f(`/api/shoots/${legacySid}`, undefined, { port: 3218 });
  assert.equal(upgraded.status, 200);
  assert.ok(upgraded.j.shoot.jobId);
  const legacyIndex = messages.length - 1;
  assert.equal(messages[legacyIndex].body.sid, legacySid);
  for (let delivery = 1; delivery <= 12 && (await shoots.getMeta(legacySid)).status !== "done"; delivery++) { await pause(600); await deliver(delivery, legacyIndex); }
  assert.equal((await shoots.getMeta(legacySid)).status, "done");
  pass("one legacy progress request installs durable continuation for the remaining batches");
  await stop(cloud);
  console.log(`${count}/${count} passed`);
} catch (err) {
  console.error(err);
  for (const name of ["server-1", "server-2", "server-restarted", "publisher-failure", "queue-callback", "queue-callback-restarted", "mock"]) {
    const log = await fs.readFile(path.join(dir, name + ".log"), "utf8").catch(() => "");
    console.error(name, log.split("\n").slice(-18).join("\n"));
  }
  process.exitCode = 1;
} finally {
  await Promise.all([...children].map(stop));
  if (broker?.listening) await new Promise((resolve) => broker.close(resolve));
  await Promise.all(logs.map(async (p) => (await p).close()));
  await fs.rm(dir, { recursive: true, force: true });
}
