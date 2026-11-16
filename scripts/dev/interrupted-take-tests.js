// DEV/QA ONLY — a free photo check or an extra look counts as used only once
// its step completes (server.js settleInterrupted). A request stopped partway
// (Vercel ends a function at 300 s, and no catch block runs) leaves its record
// on the account; once that record is older than any request can run, the
// next request from the account gives back what wasn't finished, exactly
// once, and keeps what was.
// The stop is simulated in the store: the account, mailbox and shoot records
// are copied while a real check is running and put back after it finishes
// (as if it had been stopped at that moment), then the record is aged.
// Run against a local server wired to scripts/dev/mock-ai.js with the free
// shoot on (FREE_SHOOT_OFFERED=1), and the server's DATA_DIR:
//   DATA_DIR=... node scripts/dev/interrupted-take-tests.js
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
import { lookFor } from "../../public/js/shared/catalog.js";
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const DATA = process.env.DATA_DIR;
if (!DATA) throw new Error("DATA_DIR is required");
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
async function account(email) {
  const f = client();
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Ida Kent", email, password: "password123" }) });
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email) }) });
  return f;
}
const photo = async (i) => "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("it" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userFile = (uid) => `${DATA}/users/id/${uid}.json`;
const shootFile = (sid) => `${DATA}/shoots/${sid}.json`;
const mailboxFile = (email) => `${DATA}/usage/checks/${crypto.createHash("sha256").update(email).digest("hex")}.json`;
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const edit = (file, fn) => { const d = read(file); fn(d); fs.writeFileSync(file, JSON.stringify(d)); };
const ago = (iso, ms) => new Date(Date.parse(iso) - ms).toISOString();
const TEN_MIN = 10 * 60 * 1000;
async function newShoot(f, n = 2) {
  const id = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  for (let i = 0; i < n; i++) await f(`/api/shoots/${id}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(i) }) });
  return id;
}
const checksLeft = async (f) => (await f("/api/me")).j.user.plan.checksLeft;
// Starts a check and copies the records once it has taken its free check
// (the mock AI takes about 2 s to answer). Returns the copies and the response.
async function checkCaught(f, uid, sid, email) {
  const running = f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
  let snap = null;
  for (let i = 0; i < 400 && !snap; i++) {
    const u = read(userFile(uid));
    const p = Object.values(u.checking || {}).find((x) => x.sid === sid);
    if (p?.daily) snap = { user: fs.readFileSync(userFile(uid), "utf8"), mailbox: fs.readFileSync(mailboxFile(email), "utf8"), shoot: fs.readFileSync(shootFile(sid), "utf8") };
    else await sleep(10);
  }
  return { snap, res: await running };
}
// Ages every pending check record on the account (and the shoot's run time).
function age(uid, sids) {
  edit(userFile(uid), (u) => { for (const p of Object.values(u.checking || {})) p.at = ago(p.at, TEN_MIN); });
  for (const sid of sids) edit(shootFile(sid), (m) => (m.checkStartedAt = ago(m.checkStartedAt, TEN_MIN)));
}
const t = Date.now();

// 1. Photo checks.
{
  const email = `itcheck${t}@x.com`;
  const f = await account(email);
  const me = (await f("/api/me")).j.user;
  const start = me.plan.checksLeft;

  // A check that completes: counted once, and nothing is left to settle.
  const s1 = await newShoot(f);
  const r1 = await f(`/api/shoots/${s1}/check`, { method: "POST", body: "{}" });
  ok("a completed check counts one free check", r1.status === 200 && (await checksLeft(f)) === start - 1, `${r1.status} ${start}`);
  ok("and leaves no record on the account or the mailbox", !read(userFile(me.id)).checking && !read(mailboxFile(email)).holds, JSON.stringify(read(mailboxFile(email))));
  age(me.id, []);
  ok("a completed check is never given back", (await checksLeft(f)) === start - 1);

  // A check stopped after taking its free check, before the AI answered.
  const s2 = await newShoot(f);
  const { snap, res } = await checkCaught(f, me.id, s2, email);
  ok("the running check recorded what it took", !!snap && res.status === 200, res.status);
  fs.writeFileSync(userFile(me.id), snap.user);
  fs.writeFileSync(mailboxFile(email), snap.mailbox);
  fs.writeFileSync(shootFile(s2), snap.shoot);
  const u0 = read(userFile(me.id));
  ok("(the stopped check: counted on the account and the mailbox)", u0.usage.checks === 2 && read(mailboxFile(email)).checks === 2 && Object.keys(read(mailboxFile(email)).holds || {}).length === 1 && read(shootFile(s2)).status === "checking");
  ok("a recent record is left alone (its request may still be running)", (await checksLeft(f)) === start - 2 && !!read(userFile(me.id)).checking);
  age(me.id, [s2]);
  const back = await checksLeft(f);
  const u1 = read(userFile(me.id));
  const mb1 = read(mailboxFile(email));
  ok("once it's old, the next request gives the free check back", back === start - 1, `${back}`);
  ok("on the account, the mailbox and the day's count", u1.usage.checks === 1 && !u1.checking && mb1.checks === 1 && !mb1.holds && u1.usage.checkDay.n === u0.usage.checkDay.n - 1, JSON.stringify({ usage: u1.usage, mb1 }));
  await f("/api/me");
  await f(`/api/shoots/${s1}`);
  const u2 = read(userFile(me.id));
  ok("exactly once", (await checksLeft(f)) === start - 1 && u2.usage.checks === 1 && read(mailboxFile(email)).checks === 1 && u2.usage.checkDay.n === u1.usage.checkDay.n);
  // The shoot itself recovers (a timed-out check) and can be checked again.
  const page = await f(`/api/shoots/${s2}`);
  const again = await f(`/api/shoots/${s2}/check`, { method: "POST", body: "{}" });
  ok("the check can be run again, and counts then", page.j?.shoot?.status !== "checking" && again.status === 200 && (await checksLeft(f)) === start - 2, `${page.j?.shoot?.status} ${again.status} ${again.j?.error || ""}`);

  // A check that finished but was stopped before clearing its record: kept.
  const s3 = await newShoot(f);
  const c3 = await checkCaught(f, me.id, s3, email);
  ok("(another running check caught)", !!c3.snap && c3.res.status === 200);
  fs.writeFileSync(userFile(me.id), c3.snap.user);
  fs.writeFileSync(mailboxFile(email), c3.snap.mailbox);
  age(me.id, [s3]);
  const kept = await checksLeft(f);
  ok("a check that finished stays counted", kept === start - 3 && !read(userFile(me.id)).checking && !read(mailboxFile(email)).holds && read(mailboxFile(email)).checks === 3, `${kept}`);

  // Two requests settling the same old record at once give it back once.
  const s4 = await newShoot(f);
  const c4 = await checkCaught(f, me.id, s4, email);
  fs.writeFileSync(userFile(me.id), c4.snap.user);
  fs.writeFileSync(mailboxFile(email), c4.snap.mailbox);
  fs.writeFileSync(shootFile(s4), c4.snap.shoot);
  age(me.id, [s4]);
  await Promise.all([f("/api/me"), f("/api/me"), f("/api/me"), f(`/api/shoots/${s4}/check`, { method: "POST", body: "{}" })]);
  const u4 = read(userFile(me.id));
  ok("settling in parallel gives it back once", u4.usage.checks === 3 && read(mailboxFile(email)).checks === 3 && !u4.checking, JSON.stringify({ usage: u4.usage, mb: read(mailboxFile(email)) }));
}

// 2. Extra looks.
{
  const email = `itlooks${t}@x.com`;
  const f = await account(email);
  const me = (await f("/api/me")).j.user;
  const sid = await newShoot(f);
  await f(`/api/shoots/${sid}/check`, { method: "POST", body: "{}" });
  await f(`/api/shoots/${sid}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }] }) });
  let s;
  for (let i = 0; i < 60; i++) {
    await sleep(1500);
    s = (await f(`/api/shoots/${sid}`)).j.shoot;
    if (!["generating", "reviewing"].includes(s.status)) break;
  }
  ok("(a developed shoot)", s?.status === "done", s?.status);
  const A = { backdrop: "glass-office", outfit: "navy-suit" }, Bk = { backdrop: "studio-gray", outfit: "white-shirt" };
  const ids = [lookFor(A.backdrop, A.outfit).id, lookFor(Bk.backdrop, Bk.outfit).id];
  const looksOf = async () => (await f("/api/me")).j.user.extraLooks[sid];
  // Bought 2; a request took 1 and was stopped before the shoot got it.
  edit(userFile(me.id), (u) => {
    u.extraLooks = { ...u.extraLooks, [sid]: 1 };
    u.addingLooks = { [sid]: { n: 1, looks: [ids[0]], at: new Date().toISOString() } };
  });
  const busy = await f(`/api/shoots/${sid}/more-looks`, { method: "POST", body: JSON.stringify({ looks: [Bk] }) });
  ok("while a request is adding looks, another is refused", busy.status === 409 && (await looksOf()) === 1, `${busy.status}`);
  edit(userFile(me.id), (u) => (u.addingLooks[sid].at = ago(u.addingLooks[sid].at, TEN_MIN)));
  ok("once its record is old, the look comes back", (await looksOf()) === 2 && !read(userFile(me.id)).addingLooks);
  await f("/api/me");
  ok("exactly once", (await looksOf()) === 2 && read(userFile(me.id)).extraLooks[sid] === 2);
  const r = await f(`/api/shoots/${sid}/more-looks`, { method: "POST", body: JSON.stringify({ looks: [A, Bk] }) });
  ok("the looks can then be added", r.status === 202 && r.j.shoot.looks.length === 3 && r.j.user.extraLooks[sid] === undefined, `${r.status} ${r.j?.error || ""}`);
  ok("a completed request leaves no record", !read(userFile(me.id)).addingLooks);
  // Added, but stopped before its record was cleared: nothing comes back.
  edit(userFile(me.id), (u) => (u.addingLooks = { [sid]: { n: 2, looks: ids, at: ago(new Date().toISOString(), TEN_MIN) } }));
  ok("looks the shoot did get aren't given back", (await looksOf()) === undefined && !read(userFile(me.id)).addingLooks);
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
