// DEV/QA ONLY — customer reviews (lib/reviews.js): who may review, what a
// review may contain, the owner's approval, the one review-request email, and
// that deleting the account deletes the review.
// The first half runs in-process against a throwaway store; the second half
// needs a local server wired to scripts/dev/mock-ai.js (as in ci.sh), with
// review-owner@example.com among OWNER_EMAILS:
//   node scripts/dev/review-tests.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kh-reviews-"));
process.env.SESSION_SECRET = process.env.SERVER_SESSION_SECRET || "ci-session-secret-ci-session-secret";
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_BASE_URL = M;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;
delete process.env.SMTP_PASS;
const storage = await import("../../lib/storage.js");
const { users, shoots } = await import("../../lib/store.js");
const reviews = await import("../../lib/reviews.js");
const { dueReminder, runReminders, reviewSkipReason } = await import("../../lib/reminders.js");
const { reminderEmail } = await import("../../lib/mail.js");

const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const t = Date.now();
let n = 0;
async function person(tag, extra = {}) {
  const u = { id: `usr_rev${t}${n++}`, name: `${tag} Person`, email: `${tag}${t}@x.com`, createdAt: ago(40), emailVerified: true, usage: {}, credits: 2, ...extra };
  await users.create(u);
  return u;
}
async function doneShoot(u, days, extra = {}) {
  const sid = `sht_rev${t}${n++}`;
  await shoots.create({ id: sid, userId: u.id, name: sid, status: "done", createdAt: ago(days), selfies: [], shots: [{ id: "shot_a" }], ...extra });
  await storage.putJSON(`shoots/${sid}.json`, { ...(await shoots.getMeta(sid)), updatedAt: ago(days) });
  return sid;
}
const fresh = (u) => users.byId(u.id);
const bought = [{ sessionId: "cs_a", packageId: "starter", shoots: 3, amount: 1450, at: ago(10) }];
const fails = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

// 1. Who is asked, and when.
{
  const payer = await person("payer", { purchases: bought });
  await doneShoot(payer, 4);
  ok("a paying customer is asked for a review 3 days after a shoot finishes", (await dueReminder(await fresh(payer)))?.kind === "review");
  const early = await person("early", { purchases: bought });
  await doneShoot(early, 2);
  ok("…not before 3 days", !(await dueReminder(await fresh(early))));
  const late = await person("late", { purchases: bought });
  await doneShoot(late, 31);
  ok("…and an earlier customer is still asked, once (owner's decision, 13 Nov)", (await dueReminder(await fresh(late)))?.kind === "review");
  await users.update(late.id, (u) => void (u.reminders = { review: ago(1) })); // so the run below is about the first customer
  ok("…never again after that", !(await dueReminder(await fresh(late))));
  const free = await person("free", { credits: 0 });
  const fs1 = await doneShoot(free, 40);
  await users.update(free.id, (u) => void (u.usage = { freeShootUsed: fs1 }));
  ok("someone who hasn't paid isn't asked", (await dueReminder(await fresh(free)))?.kind !== "review");
  const refunded = await person("refunded", { purchases: [{ ...bought[0], refunded: true }], credits: 0 });
  await doneShoot(refunded, 4);
  ok("a fully refunded customer isn't asked", (await dueReminder(await fresh(refunded)))?.kind !== "review" && !reviews.canReview(await fresh(refunded)));
  const member = await person("member", { credits: 0 });
  await doneShoot(member, 4, { team: { id: "team_x", name: "Acme" }, paidWith: "team" });
  ok("a team member whose admin paid isn't asked", !(await dueReminder(await fresh(member))));
  const off = await person("off", { purchases: bought, remindersOff: true });
  await doneShoot(off, 4);
  ok("reminders turned off: no request", !(await dueReminder(await fresh(off))));
  const already = await person("already", { purchases: bought });
  await doneShoot(already, 4);
  await reviews.submit(already, { rating: 5, text: "Great", name: "Al", consent: true });
  ok("someone who already reviewed isn't asked", !(await dueReminder(await fresh(already))));
  const demo = await person("demo", { purchases: bought, demo: true });
  await doneShoot(demo, 4);
  ok("the demo account isn't asked and can't review", !(await dueReminder(await fresh(demo))) && !reviews.canReview(demo));

  const unconfirmed = await person("unconfirmed", { purchases: bought, emailVerified: false });
  await doneShoot(unconfirmed, 4);
  const reasons = [await reviewSkipReason(await fresh(early)), await reviewSkipReason(await fresh(off)), await reviewSkipReason(await fresh(already)), await reviewSkipReason(await fresh(unconfirmed)), await reviewSkipReason(await fresh(free)), await reviewSkipReason(await fresh(late))];
  ok("the job can say why a paying customer isn't asked yet", /^shoot last changed 2\.0 days ago/.test(reasons[0]) && reasons[1] === "reminders turned off" && reasons[2] === "already reviewed" && reasons[3] === "address not confirmed" && reasons[4] === null && reasons[5] === null && !(await dueReminder(await fresh(unconfirmed))), JSON.stringify(reasons));

  const before = (await fetch(`${M}/mock-mail`).then((r) => r.json()).catch(() => [])).length;
  const r1 = await runReminders({ origin: "https://example.test", state: {} });
  const sent = (await fetch(`${M}/mock-mail`).then((r) => r.json())).slice(before).filter((m) => m.to.includes(payer.email));
  ok("the request is sent once, links to the review page and can be unsubscribed", sent.length === 1 && sent[0].subject === "How did your headshots turn out?" && sent[0].links.some((l) => l === "https://example.test/app/review") && sent[0].links.some((l) => l.includes("/unsubscribe?token=")), JSON.stringify([r1, sent.map((m) => m.subject)]));
  await runReminders({ origin: "https://example.test", state: {} });
  const again = (await fetch(`${M}/mock-mail`).then((r) => r.json())).slice(before).filter((m) => m.to.includes(payer.email));
  ok("…and never a second time", again.length === 1 && !!(await fresh(payer)).reminders?.review && !(await dueReminder(await fresh(payer))));
  const mail = reminderEmail({ kind: "review", name: "Ada Lovelace", link: "https://x/app/review", pricing: "https://x/#pricing", unsubscribe: "https://x/u" });
  ok("the email greets by first name and says it's the only time", mail.text.includes("Hi Ada,") && mail.text.includes("only time we'll ask") && mail.html.includes("Leave a review"));
}

// 2. What a review may contain.
{
  const u = await person("writer", { purchases: bought });
  const bad = async (fields) => (await fails(() => reviews.submit(u, { rating: 5, text: "Good", name: "Wren", consent: true, ...fields })))?.field || null;
  const checks = [await bad({ rating: 0 }), await bad({ rating: 6 }), await bad({ rating: 4.5 }), await bad({ rating: "x" }), await bad({ name: "" }), await bad({ name: "ㅤㅤ" }), await bad({ name: "www.evil.xyz" }), await bad({ name: "a@b.co" }), await bad({ text: "see http://evil.example" }), await bad({ text: "visit evil.xyz now" }), await bad({ text: "x".repeat(601) }), await bad({ consent: "yes" }), await bad({ consent: undefined })];
  ok("bad ratings, names, links, long text and missing permission are refused", JSON.stringify(checks) === JSON.stringify(["rating", "rating", "rating", "rating", "name", "name", "name", "name", "text", "text", "text", "consent", "consent"]), JSON.stringify(checks));
  const { review, first } = await reviews.submit(u, { rating: 4, text: "  Loved <b>it</b>‮\n very   much ", name: " Wren​ ", consent: true });
  ok("a review is saved cleaned, waiting for approval", review.rating === 4 && review.text === "Loved b it /b very much" && review.name === "Wren" && review.status === "pending" && first === true, JSON.stringify(review));
  ok("nothing is public before approval", (await reviews.approved()).count === 0);
  await reviews.decide(u.id, "approved");
  const pub = await reviews.approved();
  ok("an approved review is listed with the count and average, without the account", pub.count === 1 && pub.average === 4 && pub.reviews[0].name === "Wren" && !JSON.stringify(pub).includes(u.id) && !JSON.stringify(pub).includes(u.email), JSON.stringify(pub));
  const second = await reviews.submit(u, { rating: 2, text: "", name: "Wren", consent: true });
  ok("sending it again replaces it and it waits for approval again", second.review.status === "pending" && second.review.createdAt === review.createdAt && (await reviews.approved()).count === 0 && (await reviews.forOwner()).filter((r) => r.userId === u.id).length === 1);
  ok("an unknown decision or account is refused", !!(await fails(() => reviews.decide(u.id, "published"))) && (await reviews.decide("usr_nobody123", "approved")) === null && (await reviews.decide("../users/x", "approved")) === null);
  await reviews.remove(u.id);
  ok("deleting it removes it", (await reviews.get(u.id)) === null && (await reviews.approved()).count === 0);
}

// 3. Over HTTP.
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
const mailFor = async (email) => (await fetch(`${M}/mock-mail`).then((r) => r.json())).filter((m) => m.to.includes(email.toLowerCase()));
async function account(email, name = "QA Person") {
  const f = client();
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password: "password123" }) });
  const token = new URL((await mailFor(email)).flatMap((m) => m.links).find((l) => l.includes("/verify?token="))).searchParams.get("token");
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token }) });
  return f;
}
{
  const anon = client();
  const a1 = await anon("/api/review", { method: "POST", body: JSON.stringify({ rating: 5, name: "A", consent: true }) });
  const a2 = await anon("/api/owner/reviews");
  ok("signed out: no review, no owner list", a1.status === 401 && a2.status === 401, `${a1.status} ${a2.status}`);
  const email = `revbuyer${t}@x.com`;
  const f = await account(email, "Rita Buyer");
  const mine0 = await f("/api/review/mine");
  const early = await f("/api/review", { method: "POST", body: JSON.stringify({ rating: 5, text: "Nice", name: "Rita", consent: true }) });
  ok("an account that hasn't bought can't review", mine0.j?.eligible === false && early.status === 403 && early.j?.code === "not_customer", `${mine0.j?.eligible} ${early.status}`);
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sess = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sess}`, { redirect: "manual" });
  await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sess }) });
  const noStars = await f("/api/review", { method: "POST", body: JSON.stringify({ text: "Nice", name: "Rita", consent: true }) });
  const noTick = await f("/api/review", { method: "POST", body: JSON.stringify({ rating: 5, text: "Nice", name: "Rita" }) });
  ok("no stars or no permission: refused with the field named", noStars.status === 400 && !!noStars.j?.fields?.rating && noTick.status === 400 && !!noTick.j?.fields?.consent, `${noStars.status} ${noTick.status}`);
  const sent = await f("/api/review", { method: "POST", body: JSON.stringify({ rating: 5, text: "The headshots look like me. Used one for LinkedIn.", name: "Rita", consent: true }) });
  const mine = await f("/api/review/mine");
  ok("a customer's review is saved and shown back to them as waiting", sent.status === 200 && mine.j?.eligible === true && mine.j?.review?.rating === 5 && mine.j?.review?.status === "pending" && !("userId" in (mine.j?.review || {})), JSON.stringify(mine.j));
  const pub0 = await anon("/api/reviews");
  ok("the public list doesn't include it yet", pub0.status === 200 && !JSON.stringify(pub0.j).includes("LinkedIn"));
  const other = await account(`revother${t}@x.com`);
  const peek = await other("/api/owner/reviews");
  const meId = (await f("/api/me")).j?.user?.id;
  const poke = await other(`/api/owner/reviews/${meId}`, { method: "POST", body: JSON.stringify({ status: "approved" }) });
  ok("another customer can't see or approve reviews", peek.status === 404 && poke.status === 404 && (await f("/api/review/mine")).j?.review?.status === "pending");
  const ownerEmail = process.env.REVIEW_OWNER || "review-owner@example.com";
  let owner = client();
  const signIn = await owner("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: ownerEmail, password: "password123" }) });
  if (signIn.status !== 200) owner = await account(ownerEmail, "Review Owner");
  const list = await owner("/api/owner/reviews");
  const row = (list.j?.reviews || []).find((r) => r.id === meId);
  ok("the owner sees it with the customer's address, and was emailed", list.status === 200 && row?.email === email && row?.rating === 5 && (await mailFor("hello@keeperheadshots.com").catch(() => [])).concat(await fetch(`${M}/mock-mail`).then((r) => r.json())).some((m) => /\[Review\] Rita gave 5 of 5 stars/.test(m.subject)), JSON.stringify([list.status, row]));
  const yes = await owner(`/api/owner/reviews/${meId}`, { method: "POST", body: JSON.stringify({ status: "approved" }) });
  const mine2 = await f("/api/review/mine");
  ok("approving it shows the customer it's approved", yes.status === 200 && mine2.j?.review?.status === "approved", `${yes.status} ${mine2.j?.review?.status}`);
  const home = async () => (await fetch(B + "/")).text();
  const pub1 = await anon("/api/reviews");
  const page = await home();
  ok("an approved review is on the public list and in the home page's HTML, with the average", pub1.j?.count >= 1 && pub1.j.reviews.some((r) => r.name === "Rita" && r.rating === 5) && /<section class="section" id="reviews"[^>]*>[\s\S]*Rated \d\.\d out of 5[\s\S]*LinkedIn/.test(page) && !page.includes(email), `${pub1.j?.count} ${pub1.j?.average}`);
  ok("a happy reviewer with no finished shoot gets no invitation to share one", mine2.j?.shareShootId === null);
  const gone = await f("/api/review/mine", { method: "DELETE" });
  ok("the customer can delete their review", gone.status === 200 && (await f("/api/review/mine")).j?.review === null && !(await owner("/api/owner/reviews")).j?.reviews?.some((r) => r.id === meId));
  await f("/api/review", { method: "POST", body: JSON.stringify({ rating: 3, text: "Fine", name: "Rita", consent: true }) });
  const del = await f("/api/account/delete", { method: "POST", body: JSON.stringify({ password: "password123" }) });
  const after = await owner("/api/owner/reviews");
  ok("deleting the account deletes the review", del.status === 200 && !after.j?.reviews?.some((r) => r.id === meId), `${del.status} ${JSON.stringify(del.j).slice(0, 120)}`);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
