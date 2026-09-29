// DEV/QA ONLY — reminder emails (lib/reminders.js): who is due which
// reminder, that each is sent once with a one-click unsubscribe, and that the
// unsubscribe link and the account-page switch turn them off.
// The first half runs in-process against a throwaway store; the second half
// needs a local server wired to scripts/dev/mock-ai.js (as in ci.sh):
//   node scripts/dev/reminder-tests.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const SERVER_SECRET = process.env.SERVER_SESSION_SECRET || "ci-session-secret-ci-session-secret";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kh-reminders-"));
process.env.SESSION_SECRET = SERVER_SECRET; // so tokens made here work against the server
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_BASE_URL = M;
process.env.OWNER_EMAILS = "boss@example.com";
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;
delete process.env.SMTP_PASS;
const storage = await import("../../lib/storage.js");
const { users, shoots } = await import("../../lib/store.js");
const { dueReminder, runReminders, unsubscribeToken, checkUnsubscribeToken } = await import("../../lib/reminders.js");

const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const t = Date.now();
const mails = () => fetch(`${M}/mock-mail`).then((r) => r.json());
const mailsTo = async (email) => (await mails()).filter((m) => m.to.includes(email));

let n = 0;
async function person(tag, extra = {}) {
  const u = { id: `usr_rem${t}${n++}`, name: tag, email: `${tag}${t}@x.com`, createdAt: ago(30), emailVerified: true, usage: {}, credits: 0, ...extra };
  await users.create(u);
  return u;
}
async function shoot(u, { days, status = "checked", developed = false, check = true }) {
  const sid = `sht_rem${t}${n++}`;
  await shoots.create({ id: sid, userId: u.id, name: sid, status, createdAt: ago(days), selfies: [], shots: developed ? [{ id: "shot_a" }] : [], ...(check ? { check: { at: ago(days), ok: true } } : {}) });
  await storage.putJSON(`shoots/${sid}.json`, { ...(await shoots.getMeta(sid)), updatedAt: ago(days) });
  return sid;
}
const fresh = (u) => users.byId(u.id);

// 1. Who is due what.
const dev = await person("dev");
const devShoot = await shoot(dev, { days: 3 });
const buyer = await person("buyer");
const freeShoot = await shoot(buyer, { days: 5, status: "done", developed: true });
await users.update(buyer.id, (u) => void (u.usage = { freeShootUsed: freeShoot }));
{
  ok("checked but not developed → develop reminder", (await dueReminder(await fresh(dev)))?.kind === "develop");
  ok("free shoot done, nothing bought → buy reminder", (await dueReminder(await fresh(buyer)))?.kind === "buy");

  const tooSoon = await person("soon");
  await shoot(tooSoon, { days: 0.2 });
  ok("not within a day of the check", !(await dueReminder(await fresh(tooSoon))));
  const tooLate = await person("late");
  await shoot(tooLate, { days: 20 });
  ok("not after two weeks", !(await dueReminder(await fresh(tooLate))));
  const unchecked = await person("unchecked");
  await shoot(unchecked, { days: 3, status: "draft", check: false });
  ok("no reminder before a photo check", !(await dueReminder(await fresh(unchecked))));
  const developed = await person("developed");
  await shoot(developed, { days: 3 });
  await shoot(developed, { days: 4, status: "done", developed: true });
  ok("no develop reminder once something is developed", !(await dueReminder(await fresh(developed))));

  const paid = await person("paid", { purchases: [{ id: "cs_1" }] });
  const ps = await shoot(paid, { days: 5, status: "done", developed: true });
  await users.update(paid.id, (u) => void (u.usage = { freeShootUsed: ps }));
  ok("no buy reminder after a purchase", !(await dueReminder(await fresh(paid))));
  const credited = await person("credited", { credits: 2 });
  const cs = await shoot(credited, { days: 5, status: "done", developed: true });
  await users.update(credited.id, (u) => void (u.usage = { freeShootUsed: cs }));
  ok("no buy reminder with shoots left", !(await dueReminder(await fresh(credited))));

  const unverified = await person("unverified", { emailVerified: false });
  await shoot(unverified, { days: 3 });
  ok("never to an unconfirmed address", !(await dueReminder(await fresh(unverified))));
  const off = await person("off", { remindersOff: ago(1) });
  await shoot(off, { days: 3 });
  ok("never after reminders are turned off", !(await dueReminder(await fresh(off))));
  const demo = await person("demo", { demo: true });
  await shoot(demo, { days: 3 });
  ok("never to the demo account", !(await dueReminder(await fresh(demo))));
  const owner = { id: `usr_rem${t}${n++}`, name: "boss", email: "boss@example.com", createdAt: ago(30), emailVerified: true, usage: {} };
  await users.create(owner);
  await shoot(owner, { days: 3 });
  ok("never to an owner", !(await dueReminder(await fresh(owner))));
}

// 2. Unsubscribe tokens only work for their own account.
{
  const tok = unsubscribeToken(dev.id);
  ok("a token names its account", checkUnsubscribeToken(tok) === dev.id);
  ok("a changed token is refused", !checkUnsubscribeToken(tok.replace(dev.id, buyer.id)) && !checkUnsubscribeToken(tok.slice(0, -1) + (tok.endsWith("A") ? "B" : "A")) && !checkUnsubscribeToken("nonsense"));
}

// 3. A run sends each due reminder once, with one-click unsubscribe, and
// respects the daily limit.
{
  const before = (await mails()).length;
  const r1 = await runReminders({ origin: "https://example.test", limit: 1, state: {} });
  ok("the daily limit stops the run", r1.sent === 1 && r1.finished === false, JSON.stringify(r1));
  const state = {};
  const r2 = await runReminders({ origin: "https://example.test", state });
  ok("the next run sends the rest", r2.sent === 1 && r2.finished === true && state.cursor === null, JSON.stringify(r2));
  const r3 = await runReminders({ origin: "https://example.test", state });
  ok("nothing is sent twice", r3.sent === 0, JSON.stringify(r3));
  ok("exactly two emails went out", (await mails()).length - before === 2);

  const [dm] = await mailsTo(dev.email);
  ok("develop reminder links to the shoot", dm?.subject.includes("Ready to develop") && dm.links.includes(`https://example.test/app/shoot/${devShoot}`), JSON.stringify(dm));
  const unsub = dm.links.find((l) => l.includes("/unsubscribe?token="));
  ok("it has an unsubscribe link for that account", !!unsub && checkUnsubscribeToken(new URL(unsub).searchParams.get("token")) === dev.id);
  ok("it offers one-click unsubscribe", /^<https:\/\/example\.test\/api\/unsubscribe\?token=/.test(dm.headers?.["List-Unsubscribe"] || "") && dm.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", JSON.stringify(dm.headers));
  const [bm] = await mailsTo(buyer.email);
  ok("buy reminder links to the packages", bm?.subject === "Try a few more looks?" && bm.links.includes("https://example.test/#pricing"), JSON.stringify(bm));
  ok("each is recorded on the account", !!(await fresh(dev)).reminders?.develop && !!(await fresh(buyer)).reminders?.buy);
}

// 3b. An unfinished checkout gets one reminder that links back to that
// package, and then no "buy" reminder: only one reminder about buying.
{
  const shopper = await person("shopper", { lastCheckout: { packageId: "professional", at: ago(2) } });
  ok("unfinished checkout → checkout reminder", (await dueReminder(await fresh(shopper)))?.kind === "checkout");
  const soon = await person("cosoon", { lastCheckout: { packageId: "starter", at: ago(0.2) } });
  ok("not within a day of the checkout", !(await dueReminder(await fresh(soon))));
  const late = await person("colate", { lastCheckout: { packageId: "starter", at: ago(9) } });
  ok("not after a week", !(await dueReminder(await fresh(late))));
  const bought = await person("cobought", { lastCheckout: { packageId: "starter", at: ago(2) }, purchases: [{ id: "cs_9" }] });
  ok("not once they've bought", !(await dueReminder(await fresh(bought))));
  const junk = await person("cojunk", { lastCheckout: { packageId: "nope", at: ago(2) } });
  ok("not for an unknown package", !(await dueReminder(await fresh(junk))));

  const both = await person("both", { lastCheckout: { packageId: "starter", at: ago(3) } });
  const fs2 = await shoot(both, { days: 5, status: "done", developed: true });
  await users.update(both.id, (u) => void (u.usage = { freeShootUsed: fs2 }));
  ok("checkout comes before buy", (await dueReminder(await fresh(both)))?.kind === "checkout");

  const r = await runReminders({ origin: "https://example.test", state: {} });
  ok("the run sends both checkout reminders", r.sent === 2, JSON.stringify(r));
  const [m] = await mailsTo(shopper.email);
  ok("it names the package and links back to it", m?.subject === "Still deciding on your headshots?" && m.links.includes("https://example.test/app/buy/professional"), JSON.stringify(m));
  ok("it offers one-click unsubscribe", /\/api\/unsubscribe\?token=/.test(m?.headers?.["List-Unsubscribe"] || ""));
  ok("then no buy reminder too", !(await dueReminder(await fresh(both))), JSON.stringify((await fresh(both)).reminders));
}

// 4. Against the server: the unsubscribe page's call, mail apps' one-click
// POST, and the account-page switch.
{
  const f = await (async () => {
    let cookie = "";
    return async (p, o = {}) => {
      const r = await fetch(B + p, { ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
      const sc = r.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      let j = null;
      try { j = await r.json(); } catch {}
      return { status: r.status, j };
    };
  })();
  const email = `switch${t}@x.com`;
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Switch", email, password: "password123" }) });
  const me = async () => (await f("/api/me")).j.user;
  const u = await me();
  ok("reminders start on", u.emailReminders === true);

  const tok = unsubscribeToken(u.id);
  ok("a bad link is refused", (await fetch(`${B}/api/unsubscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tok.slice(0, -2) + "zz" }) })).status === 400);
  const r = await fetch(`${B}/api/unsubscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: tok }) });
  ok("the unsubscribe page turns them off", r.status === 200 && (await me()).emailReminders === false, String(r.status));

  const on = await f("/api/account/preferences", { method: "POST", body: JSON.stringify({ reminders: true }) });
  ok("the account switch turns them back on", on.status === 200 && on.j.user.emailReminders === true);
  const oneClick = await fetch(`${B}/api/unsubscribe?token=${encodeURIComponent(tok)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  ok("mail apps' one-click unsubscribe works", oneClick.status === 200 && (await me()).emailReminders === false, String(oneClick.status));
  const again = await fetch(`${B}/api/unsubscribe?token=${encodeURIComponent(tok)}`, { method: "POST" });
  ok("unsubscribing twice is fine", again.status === 200);
  const offAgain = await f("/api/account/preferences", { method: "POST", body: JSON.stringify({ reminders: "maybe" }) });
  ok("the switch needs true or false", offAgain.status === 400);
  ok("the unsubscribe page isn't indexed", /noindex/.test((await (await fetch(`${B}/unsubscribe`)).text()) + ((await fetch(`${B}/unsubscribe`)).headers.get("x-robots-tag") || "")));
}

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
