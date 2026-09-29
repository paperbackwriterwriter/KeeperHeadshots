// DEV/QA ONLY — team orders (lib/teams.js): an admin sets up a team, invites
// colleagues (each invite sets aside a shoot), and each colleague accepts with
// their own account and develops a shoot in the team's looks.
// Run against a local server wired to scripts/dev/mock-ai.js:
//   node scripts/dev/team-tests.js
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
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
const mails = () => fetch(`${M}/mock-mail`).then((r) => r.json());
const verifyToken = async (email) => new URL((await mails()).filter((m) => m.to.includes(email.toLowerCase())).flatMap((m) => m.links).find((l) => l.includes("/verify?token="))).searchParams.get("token");
async function account(email, { verify = true } = {}) {
  const f = client();
  await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: email.split("@")[0], email, password: "password123" }) });
  if (verify) await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email) }) });
  return f;
}
async function buy(f, packageId) {
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId }) });
  const id = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${id}?promo=FREE`, { redirect: "manual" });
  return (await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: id }) })).j;
}
const tokenOf = (link) => new URL(link).pathname.split("/").pop();
const credits = async (f) => (await f("/api/me")).j.user.plan.credits;
const t = Date.now();
const LOOKS = [{ backdrop: "studio-gray", outfit: "navy-suit" }];

const admin = await account(`admin${t}@x.com`);
await buy(admin, "starter"); // 3 shoots

// 1. Setting up a team.
{
  const bad = await admin("/api/team", { method: "POST", body: JSON.stringify({ name: "Acme", looks: [{ backdrop: "nope", outfit: "nope" }] }) });
  ok("a team needs a real look", bad.status === 400, String(bad.status));
  const r = await admin("/api/team", { method: "POST", body: JSON.stringify({ name: "Acme", looks: LOOKS }) });
  ok("team is created", r.status === 200 && r.j.team.name === "Acme" && r.j.team.looks.length === 1 && r.j.user.hasTeam === true, JSON.stringify(r.j?.team));
}

// 2. Invites set aside a shoot each; duplicates and bad addresses are refused.
const alice = `alice${t}@x.com`, bob = `bob${t}@x.com`;
let aliceLink, bobInvite;
{
  const r = await admin("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: `${alice}, ${bob}\nnot-an-email ${alice}` }) });
  const by = Object.fromEntries(r.j.results.map((x) => [x.email, x]));
  ok("two invites sent, one bad address refused", by[alice]?.ok && by[bob]?.ok && by["not-an-email"]?.ok === false && r.j.results.length === 3, JSON.stringify(r.j.results.map((x) => [x.email, x.ok])));
  ok("each invite sets aside a shoot", r.j.user.plan.credits === 1, String(r.j.user.plan.credits));
  aliceLink = by[alice].link;
  bobInvite = r.j.team.members.find((m) => m.email === bob);
  const dup = await admin("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: alice }) });
  ok("inviting the same person twice is refused", dup.j.results[0].ok === false && (await credits(admin)) === 1);
  const mail = (await mails()).filter((m) => m.to.includes(alice));
  ok("invite email is sent with the link", mail.some((m) => m.links.includes(aliceLink)), String(mail.length));
}

// 3. Cancelling an invite gives the shoot back and kills its link.
{
  const bobLink = (await admin(`/api/team/invites/${bobInvite.id}/link`)).j.link;
  const r = await admin(`/api/team/invites/${bobInvite.id}`, { method: "DELETE" });
  ok("cancelling returns the shoot", r.status === 200 && r.j.user.plan.credits === 2, String(r.j?.user?.plan?.credits));
  ok("a cancelled invite's link stops working", (await client()(`/api/join/${tokenOf(bobLink)}`)).status === 404);
  ok("an unknown invite link is refused", (await client()("/api/join/abcdefghijklmnopqrstuvwxyz")).status === 404);
}

// 4. Accepting needs the invited address.
const token = tokenOf(aliceLink);
{
  const look = await client()(`/api/join/${token}`);
  ok("invitation page shows the team", look.status === 200 && look.j.team.name === "Acme" && look.j.email === alice && look.j.status === "invited", JSON.stringify(look.j));
  const other = await account(`other${t}@x.com`);
  const r = await other(`/api/join/${token}`, { method: "POST" });
  ok("another account can't accept it", r.status === 403, String(r.status));
}

// 5. The invited person accepts (unverified: the link confirms the address),
// develops in the team's looks at no cost to them.
const member = await account(alice, { verify: false });
let shootId;
{
  const r = await member(`/api/join/${token}`, { method: "POST" });
  shootId = r.j?.shootId;
  ok("accepting creates a team shoot", r.status === 200 && !!shootId && r.j.user.emailVerified === true, JSON.stringify(r.j));
  ok("the invitation alone doesn't unlock the free shoot", r.j.user.plan.needsEmail === true && r.j.user.plan.canDevelop === false, JSON.stringify(r.j.user.plan));
  const again = await member(`/api/join/${token}`, { method: "POST" });
  ok("accepting again returns the same shoot", again.j?.shootId === shootId);
  ok("the invitation now points to their shoot", (await member(`/api/join/${token}`)).j.mine === shootId);
  const s = (await member(`/api/shoots/${shootId}`)).j.shoot;
  ok("the shoot carries the team's looks", s.team?.name === "Acme" && s.team.looks.length === 1, JSON.stringify(s.team));
}
const photo = async (i) => "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("tm" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
let final;
{
  for (let i = 0; i < 2; i++) await member(`/api/shoots/${shootId}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(i) }) });
  await member(`/api/shoots/${shootId}/check`, { method: "POST", body: "{}" });
  const before = (await member("/api/me")).j.user.plan;
  const g = await member(`/api/shoots/${shootId}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "library", outfit: "camel-knit" }, { backdrop: "city", outfit: "white-shirt" }] }) });
  ok("develop uses the team's looks, not the member's", g.status === 202 && g.j.shoot.looks.length === 1 && g.j.shoot.looks[0].backdrop === "studio-gray", JSON.stringify(g.j?.shoot?.looks || g.j));
  const afterPlan = (await member("/api/me")).j.user.plan;
  ok("the member isn't charged (own free shoot kept)", afterPlan.credits === before.credits && afterPlan.freeShootAvailable === before.freeShootAvailable, JSON.stringify([before, afterPlan].map((p) => [p.credits, p.freeShootAvailable])));
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    final = (await member(`/api/shoots/${shootId}`)).j.shoot;
    if (!["generating", "reviewing"].includes(final.status)) break;
  }
  ok("the team shoot develops", final.status === "done", final.status);
}

// 6. The admin sees progress and can download finished headshots, never selfies.
{
  const r = (await admin("/api/team")).j.team;
  const m = r.members.find((x) => x.email === alice);
  ok("admin sees the member's progress", m?.status === "joined" && m.shootStatus === "done" && m.done > 0 && !!m.pick, JSON.stringify(m));
  const [sid, name] = m.pick.split("/");
  ok("admin can download the headshot", (await admin(`/media/${sid}/${name}`)).status === 200);
  ok("admin can download its sizes", (await admin(`/media/${sid}/${name}?size=linkedin`)).status === 200);
  const selfie = final.selfies[0].file.split("/")[1];
  ok("admin can't see the member's selfies", (await admin(`/media/${sid}/${selfie}`)).status === 404);
  const stranger = await account(`stranger${t}@x.com`);
  ok("a stranger can't download it", (await stranger(`/media/${sid}/${name}`)).status === 404);
}

// 7. A team shoot deleted before developing gives the shoot back.
{
  const carol = `carol${t}@x.com`;
  const r = await admin("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: carol }) });
  const link = r.j.results[0].link;
  const c = await account(carol);
  const { shootId: sid } = (await c(`/api/join/${tokenOf(link)}`, { method: "POST" })).j;
  const mid = await credits(admin);
  await c(`/api/shoots/${sid}`, { method: "DELETE" });
  ok("deleting an undeveloped team shoot returns the seat", (await credits(admin)) === mid + 1, `${mid} -> ${await credits(admin)}`);
  const m = (await admin("/api/team")).j.team.members.find((x) => x.email === carol);
  ok("the member shows as returned", m?.status === "returned", m?.status);
}

// 7b. Accepting an invitation to an owner address (made by someone who
// doesn't own that inbox) never gives owner access.
{
  const target = "invite-owner@example.com";
  const r = await admin("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: target }) });
  const link = r.j.results[0].link;
  const squatter = await account(target, { verify: false });
  const j = await squatter(`/api/join/${tokenOf(link)}`, { method: "POST" });
  ok("an invitation doesn't grant owner access", j.status === 200 && j.j.user.plan.tier !== "owner", JSON.stringify(j.j?.user?.plan));
  const again = (await squatter("/api/me")).j.user.plan;
  ok("nor a free shoot for the unproven address", again.tier !== "owner" && again.canDevelop === false, JSON.stringify(again));
}

// 8. With no shoots left, invites are refused.
{
  const f = await account(`broke${t}@x.com`);
  await f("/api/team", { method: "POST", body: JSON.stringify({ name: "Broke", looks: LOOKS }) });
  const r = await f("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: `someone${t}@x.com` }) });
  ok("an invite needs a shoot to give", r.j.results[0].ok === false, r.j.results[0].error);
}

// 9. An admin who deletes their account closes the team and its open links;
// a member deleting theirs before developing gives the shoot back first.
{
  const a = await account(`closer${t}@x.com`);
  await buy(a, "starter");
  await a("/api/team", { method: "POST", body: JSON.stringify({ name: "Closing", looks: LOOKS }) });
  const r = await a("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: `dan${t}@x.com, eve${t}@x.com` }) });
  const [danLink, eveLink] = r.j.results.map((x) => x.link);
  const dan = await account(`dan${t}@x.com`);
  await dan(`/api/join/${tokenOf(danLink)}`, { method: "POST" });
  const mid = await credits(a);
  await dan("/api/account/delete", { method: "POST", body: JSON.stringify({ password: "password123" }) });
  ok("a member deleting their account returns the seat", (await credits(a)) === mid + 1, `${mid} -> ${await credits(a)}`);
  const del = await a("/api/account/delete", { method: "POST", body: JSON.stringify({ password: "password123" }) });
  ok("an admin deleting their account closes the team's links", del.status === 200 && (await client()(`/api/join/${tokenOf(eveLink)}`)).status === 404);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
