// DEV/QA ONLY — the free reshoot (POST /api/shoots/:id/reshoot): when several
// frames were held back for likeness, a new shoot with new selfies develops
// free (no credit, free shoot or free photo check), once per shoot.
// Run against a local server wired to scripts/dev/mock-ai.js, with the
// server's DATA_DIR (frames are marked held back in the store directly):
//   DATA_DIR=... node scripts/dev/reshoot-tests.js
import fs from "node:fs";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
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
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Rae Shoot", email, password: "password123" }) });
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email) }) });
  return f;
}
const photo = async (i) => "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("rs" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
const LOOKS = [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "studio-gray", outfit: "white-shirt" }];
async function develop(f, id, looks = LOOKS) {
  for (let i = 0; i < 2; i++) await f(`/api/shoots/${id}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(i) }) });
  await f(`/api/shoots/${id}/check`, { method: "POST", body: "{}" });
  return f(`/api/shoots/${id}/generate`, { method: "POST", body: JSON.stringify({ looks }) });
}
async function settle(f, id) {
  let s;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    s = (await f(`/api/shoots/${id}`)).j.shoot;
    if (!["generating", "reviewing"].includes(s.status)) break;
  }
  return s;
}
// Marks frames as held back by the quality check for likeness.
function holdBack(s, n, likeness = 5) {
  for (const t of s.shots.slice(0, n)) {
    const file = `${DATA}/shots/${s.id}/${t.id}.json`;
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...d, status: "error", file: null, error: "Held back by the quality check.", qa: { history: [{ likeness, professional: 9 }] } }));
  }
}
const userFile = (uid) => `${DATA}/users/id/${uid}.json`;
const t = Date.now();

const f = await account(`reshoot${t}@x.com`);
const me = (await f("/api/me")).j.user;
const first = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
const dev = await develop(f, first);
ok("the free shoot develops", dev.status === 202, `${dev.status} ${dev.j?.error || ""}`);
let orig = await settle(f, first);
ok("and finishes", orig.status === "done", orig.status);

// 1. Not offered until frames were held back for likeness.
{
  const r = await f(`/api/shoots/${first}/reshoot`, { method: "POST", body: "{}" });
  ok("no reshoot when nothing was held back", r.status === 400 && r.j.code === "reshoot_unavailable", `${r.status}`);
  holdBack(orig, 1);
  const one = await f(`/api/shoots/${first}/reshoot`, { method: "POST", body: "{}" });
  ok("no reshoot for a single held-back frame", one.status === 400, `${one.status}`);
  holdBack(orig, 2, 9);
  const good = await f(`/api/shoots/${first}/reshoot`, { method: "POST", body: "{}" });
  ok("frames held back for something other than likeness don't count", good.status === 400, `${good.status}`);
  holdBack(orig, 2);
  orig = (await f(`/api/shoots/${first}`)).j.shoot;
}

// 2. The reshoot: a draft with the same looks, linked both ways.
const before = JSON.parse(fs.readFileSync(userFile(me.id), "utf8"));
const made = await f(`/api/shoots/${first}/reshoot`, { method: "POST", body: "{}" });
const rid = made.j?.shoot?.id;
ok("a reshoot is made", made.status === 201 && made.j.shoot.status === "draft" && made.j.shoot.reshootOf === first, `${made.status} ${made.j?.error || ""}`);
ok("with the original's looks", JSON.stringify(made.j.shoot.looks) === JSON.stringify(LOOKS) && made.j.shoot.reshootLooks === 2);
ok("the original records it", (await f(`/api/shoots/${first}`)).j.shoot.reshootId === rid);
{
  const again = await f(`/api/shoots/${first}/reshoot`, { method: "POST", body: "{}" });
  ok("asking again returns the same reshoot", again.status === 200 && again.j.shoot.id === rid, `${again.status}`);
  const other = await account(`reshoot-other${t}@x.com`);
  const r = await other(`/api/shoots/${first}/reshoot`, { method: "POST", body: "{}" });
  ok("someone else can't reshoot it", r.status === 404, `${r.status}`);
  const nested = await f(`/api/shoots/${rid}/reshoot`, { method: "POST", body: "{}" });
  ok("a reshoot can't itself be reshot", nested.status === 400 || nested.status === 409, `${nested.status}`);
}

// 3. It develops free, though the free shoot is used and there are no credits.
{
  const plan = (await f("/api/me")).j.user.plan;
  ok("the account has no shoots left", plan.canDevelop === false && !plan.credits, JSON.stringify(plan));
  for (let i = 0; i < 2; i++) await f(`/api/shoots/${rid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(10 + i) }) });
  const check = await f(`/api/shoots/${rid}/check`, { method: "POST", body: "{}" });
  ok("the photo check runs", check.status === 200, `${check.status} ${check.j?.error || ""}`);
  // Other looks are asked for (more of them, and different ones): the reshoot
  // develops the original's looks regardless.
  const other = [{ backdrop: "studio-gray", outfit: "charcoal-blazer" }, { backdrop: "studio-white", outfit: "navy-suit" }, { backdrop: "studio-white", outfit: "white-shirt" }];
  const gen = await f(`/api/shoots/${rid}/generate`, { method: "POST", body: JSON.stringify({ looks: other }) });
  ok("the reshoot develops", gen.status === 202, `${gen.status} ${gen.j?.error || ""}`);
  const same = (a, b) => JSON.stringify(a.map((l) => [l.backdrop, l.outfit]).sort()) === JSON.stringify(b.map((l) => [l.backdrop, l.outfit]).sort());
  ok("with the original's looks, not the ones asked for", same(gen.j?.shoot?.looks || [], LOOKS) && (gen.j?.shoot?.shots || []).every((t) => LOOKS.some((l) => l.backdrop === t.backdrop && l.outfit === t.outfit)), JSON.stringify(gen.j?.shoot?.looks));
  const after = JSON.parse(fs.readFileSync(userFile(me.id), "utf8"));
  ok("nothing was charged: credits, free shoot and photo checks unchanged", (after.credits || 0) === (before.credits || 0) && after.usage?.freeShootUsed === before.usage?.freeShootUsed && (after.usage?.checks || 0) === (before.usage?.checks || 0), JSON.stringify({ before: before.usage, after: after.usage }));
  const s = await settle(f, rid);
  ok("it finishes", s.status === "done", s.status);
  ok("paid with the reshoot, and still a preview like the original", s.paidWith === "reshoot" && s.preview === true && orig.preview === true);
  const used = await f(`/api/shoots/${first}/reshoot`, { method: "POST", body: "{}" });
  ok("the free reshoot is used once it develops", used.status === 409 && used.j.code === "reshoot_used", `${used.status} ${used.j?.code}`);
  await f(`/api/shoots/${rid}`, { method: "DELETE" });
  const deleted = await f(`/api/shoots/${first}/reshoot`, { method: "POST", body: "{}" });
  ok("deleting the developed reshoot doesn't give it back", deleted.status === 409, `${deleted.status}`);
}

// 4. A reshoot deleted before developing can be made again.
{
  const g = await account(`reshoot-draft${t}@x.com`);
  const sid = (await g("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await develop(g, sid, LOOKS.slice(0, 1));
  const s = await settle(g, sid);
  holdBack(s, 2);
  const a = (await g(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" })).j.shoot.id;
  await g(`/api/shoots/${a}`, { method: "DELETE" });
  const b = await g(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" });
  ok("an undeveloped reshoot deleted can be made again", b.status === 201 && b.j.shoot.id !== a && b.j.shoot.reshootLooks === 1, `${b.status}`);
}

// 5. A reshoot's first 3 photo checks are free; later ones count as usual.
// And deleting the original makes its undeveloped reshoot an ordinary shoot.
{
  const h = await account(`reshoot-checks${t}@x.com`);
  const sid = (await h("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await develop(h, sid, LOOKS.slice(0, 1));
  holdBack(await settle(h, sid), 2);
  const rid = (await h(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" })).j.shoot.id;
  await h(`/api/shoots/${rid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(20) }) });
  const left = async () => (await h("/api/me")).j.user.plan.checksLeft;
  const start = await left();
  for (let i = 0; i < 3; i++) await h(`/api/shoots/${rid}/check`, { method: "POST", body: "{}" });
  const afterFree = await left();
  const fourth = await h(`/api/shoots/${rid}/check`, { method: "POST", body: "{}" });
  const afterFourth = await left();
  ok("a reshoot's first 3 checks are free", afterFree === start, `${start} → ${afterFree}`);
  // (Customers pay up front: with no package, a 4th isn't run at all.)
  ok("a 4th is like any other shoot's: with no package, it asks to buy", fourth.status === 402 && /Buy a package/.test(fourth.j?.error || "") && afterFourth === afterFree, `${fourth.status} ${afterFree} → ${afterFourth}`);
  // Deleting the reshoot and making it again doesn't give the free checks back.
  await h(`/api/shoots/${rid}`, { method: "DELETE" });
  const again = (await h(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" })).j.shoot.id;
  await h(`/api/shoots/${again}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(21) }) });
  const remade = await h(`/api/shoots/${again}/check`, { method: "POST", body: "{}" });
  ok("a remade reshoot doesn't get 3 more free checks", remade.status === 402, `${remade.status} ${remade.j?.error || ""}`);
  await h(`/api/shoots/${sid}`, { method: "DELETE" });
  const orphan = (await h(`/api/shoots/${again}`)).j.shoot;
  ok("deleting the original makes its reshoot an ordinary shoot", !orphan.reshootOf && !orphan.reshootLooks);
  const gen = await h(`/api/shoots/${again}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS.slice(0, 1) }) });
  // (Its photos were never checked: with no package they can't be, and it can't develop.)
  ok("which is treated like any other (here: no shoots left, so it can't develop)", [400, 402].includes(gen.status) && !/reshoot/i.test(gen.j?.error || ""), `${gen.status} ${gen.j?.error}`);
}


// 9. A package refunded in full takes its shoots' free retries and free
// reshoot with it.
{
  const g = await account(`refunded${t}@x.com`);
  const co = (await g("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) })).j;
  const psid = new URL(co.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${psid}`, { redirect: "manual" }); // (paid in full: something to refund)
  await g("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: psid }) });
  const sid = (await g("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  // (4 looks: more than a free shoot takes, so the package pays.)
  await develop(g, sid, [...LOOKS, { backdrop: "glass-office", outfit: "navy-suit" }, { backdrop: "city-terrace", outfit: "camel-knit" }]);
  const s = await settle(g, sid);
  holdBack(s, 2);
  ok("before the refund, the shoot can be reshot", (await g(`/api/shoots/${sid}`)).j.shoot && s.paidWith === "credit", s.paidWith);
  await fetch(`${M}/mock-refund/${psid}`);
  await g("/api/billing/sync", { method: "POST", body: "{}" });
  const resume = await g(`/api/shoots/${sid}/resume`, { method: "POST", body: "{}" });
  ok("after a full refund, its held-back frames can't be retried free", resume.status === 402 && resume.j?.code === "refunded", `${resume.status} ${resume.j?.error}`);
  const again = await g(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" });
  ok("…or reshot free", again.status === 402 && again.j?.code === "refunded", `${again.status} ${again.j?.error}`);
}

// 10. A team shoot gets the same free reshoot: it's the member's own shoot
// (no team seat), charges neither the member nor the admin, and the admin's
// team page shows it once done. A full refund of the admin's package that
// paid for the seat takes it away, as it does a customer's own.
async function teamSeat(tag, { refundable = false } = {}) {
  const adm = await account(`${tag}-admin${t}@x.com`);
  const co = (await adm("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) })).j;
  const psid = new URL(co.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${psid}${refundable ? "" : "?promo=FREE"}`, { redirect: "manual" });
  await adm("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: psid }) });
  await adm("/api/team", { method: "POST", body: JSON.stringify({ name: "Reshooters", looks: LOOKS }) });
  const email = `${tag}-member${t}@x.com`;
  const link = (await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: email }) })).j.results[0].link;
  // (Not confirmed: the invitation alone lets the team shoot go ahead.)
  const mem = client();
  await mem("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Tam Member", email, password: "password123" }) });
  const sid = (await mem(`/api/join/${new URL(link).pathname.split("/").pop()}`, { method: "POST" })).j.shootId;
  await develop(mem, sid);
  return { adm, mem, sid, psid, s: await settle(mem, sid) };
}
{
  const { adm, mem, sid, s } = await teamSeat("team");
  ok("the team shoot finishes", s.status === "done" && !!s.team, s.status);
  holdBack(s, 2);
  const credits = async (f) => (await f("/api/me")).j.user.plan.credits;
  const adminBefore = await credits(adm);
  const memberBefore = (await mem("/api/me")).j.user;
  const made = await mem(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" });
  const rid = made.j?.shoot?.id;
  ok("a team shoot can be reshot free", made.status === 201 && made.j.shoot.reshootOf === sid, `${made.status} ${made.j?.error || ""}`);
  ok("the reshoot isn't another team seat, and has the team's looks", !made.j?.shoot?.team && JSON.stringify(made.j?.shoot?.looks) === JSON.stringify(LOOKS), JSON.stringify(made.j?.shoot));
  for (let i = 0; i < 2; i++) await mem(`/api/shoots/${rid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(30 + i) }) });
  const check = await mem(`/api/shoots/${rid}/check`, { method: "POST", body: "{}" });
  ok("its photo check runs (the member has no package)", check.status === 200, `${check.status} ${check.j?.error || ""}`);
  const gen = await mem(`/api/shoots/${rid}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "library", outfit: "camel-knit" }] }) });
  ok("the team reshoot develops, in the team's looks", gen.status === 202 && JSON.stringify(gen.j?.shoot?.looks) === JSON.stringify(LOOKS), `${gen.status} ${gen.j?.error || ""}`);
  const r = await settle(mem, rid);
  const memberAfter = (await mem("/api/me")).j.user;
  ok("paid with the reshoot: nothing charged to the member or the admin", r.paidWith === "reshoot" && (await credits(adm)) === adminBefore && memberAfter.plan.credits === memberBefore.plan.credits && memberAfter.plan.freeShootAvailable === memberBefore.plan.freeShootAvailable && memberAfter.plan.checksLeft === memberBefore.plan.checksLeft, JSON.stringify([adminBefore, memberBefore.plan, memberAfter.plan]));
  const used = await mem(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" });
  ok("once per team shoot", used.status === 409 && used.j.code === "reshoot_used", `${used.status}`);
  const m = (await adm("/api/team")).j.team.members[0];
  const pick = m?.pick;
  ok("the admin's team page shows the reshoot's headshot", r.status === "done" && pick?.startsWith(`${rid}/`), JSON.stringify(m));
  ok("and the admin can download it", !!pick && (await adm(`/media/${pick}`)).status === 200);
  const stranger = await account(`team-stranger${t}@x.com`);
  ok("nobody else can", !!pick && (await stranger(`/media/${pick}`)).status === 404);
}
{
  const { adm, mem, sid, psid, s } = await teamSeat("team-refund", { refundable: true });
  holdBack(s, 2);
  // (The admin's package paid for the seat; it's refunded in full.)
  await fetch(`${M}/mock-refund/${psid}`);
  await adm("/api/billing/sync", { method: "POST", body: "{}" });
  const r = await mem(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" });
  ok("a team shoot whose package was refunded in full gets no free reshoot", r.status === 402 && r.j?.code === "refunded", `${r.status} ${r.j?.error}`);
}
{
  // A team member's reshoot gets the same 3 free checks; a 4th asks to buy,
  // without calling this their "first shoot".
  const { mem, sid, s } = await teamSeat("team-checks");
  holdBack(s, 2);
  const rid = (await mem(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" })).j?.shoot?.id;
  await mem(`/api/shoots/${rid}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(40) }) });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await mem(`/api/shoots/${rid}/check`, { method: "POST", body: "{}" })).status);
  // (On a server still offering the legacy free shoot, the member's own free
  // checks pay for a 4th; customers pay up front everywhere else.)
  const tier = (await mem("/api/me")).j.user.plan.tier;
  const fourth = await mem(`/api/shoots/${rid}/check`, { method: "POST", body: "{}" });
  ok("a team member's reshoot: 3 free checks, then a 4th asks to buy, not to 'start your first shoot'", codes.every((c) => c === 200) && (tier === "none" ? fourth.status === 402 && /free reshoot/.test(fourth.j?.error || "") && !/first shoot/.test(fourth.j?.error || "") : fourth.status === 200), `${tier} ${codes} ${fourth.status} ${fourth.j?.error}`);
}

// 11. A headshot shared from a free reshoot comes down when the package that
// paid for the original shoot is refunded in full (the privacy policy's
// promise), for a customer's own shoot and for a team seat.
async function shareFromReshoot(f, sid, s) {
  holdBack(s, 2);
  const rid = (await f(`/api/shoots/${sid}/reshoot`, { method: "POST", body: "{}" })).j?.shoot?.id;
  await develop(f, rid);
  const r = await settle(f, rid);
  const done = r.shots.find((x) => x.status === "done");
  const shared = await f("/api/showcase", { method: "POST", body: JSON.stringify({ consent: true, shootId: rid, shotId: done?.id, name: "Shared Person", role: "", quote: "" }) });
  return shared.status === 200 && r.paidWith === "reshoot";
}
const mine = async (f) => (await f("/api/showcase/mine")).j?.entry || null;
{
  const g = await account(`share-own${t}@x.com`);
  const co = (await g("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) })).j;
  const psid = new URL(co.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${psid}`, { redirect: "manual" });
  await g("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: psid }) });
  const sid = (await g("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await develop(g, sid, [...LOOKS, { backdrop: "glass-office", outfit: "navy-suit" }, { backdrop: "city-terrace", outfit: "camel-knit" }]);
  const shared = await shareFromReshoot(g, sid, await settle(g, sid));
  const before = await mine(g);
  await fetch(`${M}/mock-refund/${psid}`);
  await g("/api/billing/sync", { method: "POST", body: "{}" });
  ok("a headshot shared from a reshoot comes down when the original's package is refunded in full", shared && !!before && !(await mine(g)), `${shared} ${!!before}`);
}
{
  const { adm, mem, sid, psid, s } = await teamSeat("share-team", { refundable: true });
  const shared = await shareFromReshoot(mem, sid, s);
  const before = await mine(mem);
  await fetch(`${M}/mock-refund/${psid}`);
  await adm("/api/billing/sync", { method: "POST", body: "{}" });
  ok("…and from a team member's reshoot, when the admin's package is refunded in full", shared && !!before && !(await mine(mem)), `${shared} ${!!before}`);
}

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
