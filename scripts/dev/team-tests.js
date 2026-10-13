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
  const status = (await admin("/api/team")).j;
  const r = status.team;
  ok("the team page gets the account as it is now", typeof status.user?.id === "string" && typeof status.user?.plan?.credits === "number" && status.user.plan.credits === status.credits, JSON.stringify({ user: status.user?.plan, credits: status.credits }));
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

// 9. A refund after the seats were spent: cancelling those invites can't
// hand the refunded credits back.
{
  const admin2 = await account(`refund-admin${t}@x.com`);
  const { j } = await admin2("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sid = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sid}`, { redirect: "manual" }); // paid in full, so it can be refunded
  await admin2("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid }) });
  await admin2("/api/team", { method: "POST", body: JSON.stringify({ name: "Refunders", looks: LOOKS }) });
  const sent = (await admin2("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: [1, 2, 3].map((i) => `r${i}.${t}@x.com`).join(", ") }) })).j;
  ok("three seats spend the package", sent.results.filter((x) => x.ok).length === 3 && (await credits(admin2)) === 0, JSON.stringify(sent.results));
  await fetch(`${M}/mock-refund/${sid}`);
  const synced = (await admin2("/api/billing/sync", { method: "POST", body: "{}" })).j;
  ok("the refund finds nothing left to take back", synced.removed === 3 && (await credits(admin2)) === 0, JSON.stringify(synced));
  const members = (await admin2("/api/team")).j.team.members;
  ok("the refund withdraws the open invitations", members.filter((m) => m.status === "invited").length === 0 && (await client()(`/api/join/${tokenOf(sent.results[0].link)}`)).status === 404, JSON.stringify(members.map((m) => m.status)));
  ok("nothing is handed back", (await credits(admin2)) === 0, String(await credits(admin2)));
  const again = await admin2("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sid2 = new URL(again.j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sid2}`, { redirect: "manual" });
  await admin2("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid2 }) });
  ok("a new package after a settled refund is all credits", (await credits(admin2)) === 3, String(await credits(admin2)));
}

// 9b. A refund after a colleague already accepted: their seat is no longer
// paid for until the admin buys again.
{
  const admin4 = await account(`debt-admin${t}@x.com`);
  const { j } = await admin4("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sid = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sid}`, { redirect: "manual" });
  await admin4("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid }) });
  await admin4("/api/team", { method: "POST", body: JSON.stringify({ name: "Debtors", looks: LOOKS }) });
  const eve = `eve${t}@x.com`;
  const fay = `fay${t}@x.com`;
  const sent = (await admin4("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: `${eve}, ${fay}, spare2.${t}@x.com` }) })).j;
  // Fay develops her seat and shares a headshot before the refund.
  const fayC = await account(fay);
  const faySeat = (await fayC(`/api/join/${tokenOf(sent.results.find((r) => r.email === fay).link)}`, { method: "POST" })).j.shootId;
  for (let i = 0; i < 2; i++) await fayC(`/api/shoots/${faySeat}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(40 + i) }) });
  await fayC(`/api/shoots/${faySeat}/check`, { method: "POST", body: "{}" });
  for (let w = 0; w < 60 && (await fayC(`/api/shoots/${faySeat}`)).j.shoot.status === "checking"; w++) await new Promise((r) => setTimeout(r, 250));
  await fayC(`/api/shoots/${faySeat}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  let fayShoot;
  for (let w = 0; w < 80; w++) {
    await new Promise((r) => setTimeout(r, 1000));
    fayShoot = (await fayC(`/api/shoots/${faySeat}`)).j.shoot;
    if (!["generating", "reviewing", "checking"].includes(fayShoot.status)) break;
  }
  const fayShot = (fayShoot?.shots || []).find((x) => x.status === "done");
  const shared = await fayC("/api/showcase", { method: "POST", body: JSON.stringify({ shootId: faySeat, shotId: fayShot?.id, name: "Fay", role: "Analyst", quote: "Great.", consent: true }) });
  ok("a colleague can share a headshot from a developed team seat", fayShoot?.status === "done" && shared.status === 200, `${fayShoot?.status} ${shared.status} ${JSON.stringify(shared.j)}`);
  const member = await account(eve);
  const seat = (await member(`/api/join/${tokenOf(sent.results.find((r) => r.email === eve).link)}`, { method: "POST" })).j.shootId;
  await member(`/api/shoots/${seat}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(31) }) });
  await member(`/api/shoots/${seat}/check`, { method: "POST", body: "{}" });
  for (let w = 0; w < 60 && (await member(`/api/shoots/${seat}`)).j.shoot.status === "checking"; w++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${M}/mock-refund/${sid}`);
  await admin4("/api/billing/sync", { method: "POST", body: "{}" });
  const after = (await admin4("/api/team")).j.team.members;
  ok("the open invitation is withdrawn, the taken seats stay listed", after.filter((m) => m.status === "invited").length === 0 && after.some((m) => m.email === eve && m.status === "joined"), JSON.stringify(after.map((m) => [m.email === eve, m.status])));
  ok("the colleague's shared headshot comes down with the admin's refund", (await fayC("/api/showcase/mine")).j.entry === null && (await fayC(`/showcase/${shared.j?.entry?.id}.webp`)).status === 404, JSON.stringify((await fayC("/api/showcase/mine")).j));
  const dev = await member(`/api/shoots/${seat}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  ok("the taken seat can't develop while the refund debt stands", dev.status === 402 && dev.j?.code === "team_unpaid", `${dev.status} ${JSON.stringify(dev.j)}`);
  {
    // Nor are its photo checks free any more: they're the colleague's own.
    const left = async () => (await member("/api/me")).j.user.plan.checksLeft;
    const before = await left();
    await member(`/api/shoots/${seat}/check`, { method: "POST", body: "{}" });
    for (let w = 0; w < 60 && (await member(`/api/shoots/${seat}`)).j.shoot.status === "checking"; w++) await new Promise((r) => setTimeout(r, 250));
    ok("an unpaid seat's photo check counts as the colleague's own", before != null && (await left()) === before - 1, `${before} → ${await left()}`);
  }
  const buy2 = await admin4("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sid2 = new URL(buy2.j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sid2}?promo=FREE`, { redirect: "manual" });
  await admin4("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid2 }) });
  ok("a new package settles the debt first", (await credits(admin4)) === 2, String(await credits(admin4)));
  const dev2 = await member(`/api/shoots/${seat}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  ok("and the seat develops again", dev2.status === 202, `${dev2.status} ${JSON.stringify(dev2.j)}`);
}

// 9c. An admin who deletes their account leaves colleagues' seats paid for:
// the credit went when the invitation was sent.
{
  const adm = await account(`gone-admin${t}@x.com`);
  await buy(adm, "starter");
  await adm("/api/team", { method: "POST", body: JSON.stringify({ name: "Leavers", looks: LOOKS }) });
  const gil = `gil${t}@x.com`;
  const sent = (await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: gil }) })).j;
  const gilC = await account(gil);
  const seat = (await gilC(`/api/join/${tokenOf(sent.results[0].link)}`, { method: "POST" })).j.shootId;
  await gilC(`/api/shoots/${seat}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(50) }) });
  await gilC(`/api/shoots/${seat}/check`, { method: "POST", body: "{}" });
  for (let w = 0; w < 60 && (await gilC(`/api/shoots/${seat}`)).j.shoot.status === "checking"; w++) await new Promise((r) => setTimeout(r, 250));
  const del = await adm("/api/account/delete", { method: "POST", body: JSON.stringify({ password: "password123" }) });
  const dev = await gilC(`/api/shoots/${seat}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  ok("a colleague's checked seat still develops after the admin deletes their account", del.status === 200 && dev.status === 202, `${del.status} ${dev.status} ${JSON.stringify(dev.j?.error)}`);
}

// 9d. One address gets at most 3 invitation emails a day, however often it's
// invited, cancelled and invited again, or resent.
{
  const adm = await account(`cap-admin${t}@x.com`);
  await buy(adm, "starter");
  await adm("/api/team", { method: "POST", body: JSON.stringify({ name: "Cappers", looks: LOOKS }) });
  const who = `capped${t}@x.com`;
  const sends = [];
  for (let i = 0; i < 4; i++) {
    const r = (await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: who }) })).j.results[0];
    sends.push(r.sent ? "sent" : r.capped ? "capped" : "no");
    const id = (await adm("/api/team")).j.team.members.find((m) => m.email === who && m.status === "invited")?.id;
    if (i < 3) await adm(`/api/team/invites/${id}`, { method: "DELETE" });
  }
  const id = (await adm("/api/team")).j.team.members.find((m) => m.email === who && m.status === "invited")?.id;
  const resend = await adm(`/api/team/invites/${id}/resend`, { method: "POST" });
  const got = (await mails()).filter((m) => m.to.includes(who)).length;
  ok("an address gets at most 3 invitation emails a day", sends.join(",") === "sent,sent,sent,capped" && resend.status === 429 && got === 3, `${sends.join(",")} resend=${resend.status} emails=${got}`);
}

// 9e. A member who deletes their account leaves the team's list without
// their name or address.
{
  const adm = await account(`scrub-admin${t}@x.com`);
  await buy(adm, "starter");
  await adm("/api/team", { method: "POST", body: JSON.stringify({ name: "Scrubbers", looks: LOOKS }) });
  const hal = `hal${t}@x.com`;
  const sent = (await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: hal }) })).j;
  const halC = await account(hal);
  await halC(`/api/join/${tokenOf(sent.results[0].link)}`, { method: "POST" });
  await halC("/api/account/delete", { method: "POST", body: JSON.stringify({ password: "password123" }) });
  // A second member deletes their (undeveloped) team shoot first, then the account.
  const kit = `kit${t}@x.com`;
  const sent2 = (await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: kit }) })).j;
  const kitC = await account(kit);
  const kitSeat = (await kitC(`/api/join/${tokenOf(sent2.results[0].link)}`, { method: "POST" })).j.shootId;
  await kitC(`/api/shoots/${kitSeat}`, { method: "DELETE" });
  await kitC("/api/account/delete", { method: "POST", body: JSON.stringify({ password: "password123" }) });
  ok("a member who deleted their team shoot before their account is forgotten too", !JSON.stringify((await adm("/api/team")).j.team.members).includes(kit));
  const members = (await adm("/api/team")).j.team.members;
  ok("a deleted member's name and address leave the team record", !JSON.stringify(members).includes(hal) && members.some((m) => m.status === "account_deleted" && m.name === "Deleted account"), JSON.stringify(members.map((m) => [m.email, m.status])));
}

// 9f. A refund while a colleague's photo check is running still counts that
// seat, so deleting the shoot afterwards doesn't hand the refunded credit back.
{
  const adm = await account(`checkref-admin${t}@x.com`);
  const { j } = await adm("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sid = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sid}`, { redirect: "manual" });
  await adm("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid }) });
  await adm("/api/team", { method: "POST", body: JSON.stringify({ name: "Checkers", looks: LOOKS }) });
  const ivy = `ivy${t}@x.com`;
  const sent = (await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: ivy }) })).j;
  const ivyC = await account(ivy);
  const seat = (await ivyC(`/api/join/${tokenOf(sent.results[0].link)}`, { method: "POST" })).j.shootId;
  await ivyC(`/api/shoots/${seat}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(60) }) });
  const check = ivyC(`/api/shoots/${seat}/check`, { method: "POST", body: "{}" });
  for (let w = 0; w < 40 && (await ivyC(`/api/shoots/${seat}`)).j.shoot.status !== "checking"; w++) await new Promise((r) => setTimeout(r, 50));
  await fetch(`${M}/mock-refund/${sid}`);
  await adm("/api/billing/sync", { method: "POST", body: "{}" });
  await check;
  await ivyC(`/api/shoots/${seat}`, { method: "DELETE" });
  const left = await credits(adm);
  ok("a refund during a colleague's photo check doesn't hand a credit back later", left === 0, String(left));
}

// 9g. Each address counts towards the hourly invite limit, however they're batched.
{
  const adm = await account(`batch-admin${t}@x.com`);
  await buy(adm, "starter");
  await adm("/api/team", { method: "POST", body: JSON.stringify({ name: "Batchers", looks: LOOKS }) });
  const list = (n, k) => Array.from({ length: n }, (_, i) => `b${k}-${i}.${t}@x.com`).join(", ");
  await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: list(25, 1) }) });
  const second = (await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: list(6, 2) }) })).j.results;
  ok("the 31st address in an hour is refused, across batches", /lot of invites in one hour/.test(second[5]?.error || "") && !/lot of invites/.test(second[4]?.error || ""), JSON.stringify(second.map((r) => r.error || "ok")));
}

// 9h. An account confirmed only by a team invitation keeps its team shoot
// when the address's inbox resets the password from another device: it's a
// member's paid seat, and the admin mustn't win the seat back this way.
{
  const adm = await account(`squat-admin${t}@x.com`);
  await buy(adm, "starter");
  await adm("/api/team", { method: "POST", body: JSON.stringify({ name: "Squatters", looks: LOOKS }) });
  const vic = `victim${t}@x.com`;
  const sent = (await adm("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: vic }) })).j;
  const squatter = await account(vic, { verify: false });
  const seat = (await squatter(`/api/join/${tokenOf(sent.results[0].link)}`, { method: "POST" })).j.shootId;
  await squatter(`/api/shoots/${seat}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(70) }) });
  const before = await credits(adm);
  const owner = client();
  await owner("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: vic }) });
  await new Promise((r) => setTimeout(r, 800));
  const link = (await mails()).filter((m) => m.to.includes(vic)).flatMap((m) => m.links).findLast((l) => l.includes("/reset?token="));
  const reset = await owner("/api/auth/password/reset", { method: "POST", body: JSON.stringify({ token: new URL(link).searchParams.get("token"), password: "the-real-owner-1" }) });
  const left = (await owner("/api/shoots")).j?.shoots || [];
  ok("an invitation-confirmed account reset from another device keeps its team shoot, and the admin gains no credit", !!seat && reset.status === 200 && left.length === 1 && (await credits(adm)) === before, `${reset.status} shoots=${left.length} credits ${before}->${await credits(adm)}`);
}

// 10. A team seat is paid for by the admin: the member's free photo checks
// don't gate it and aren't spent on it.
{
  const admin3 = await account(`seat-admin${t}@x.com`);
  await buy(admin3, "starter");
  await admin3("/api/team", { method: "POST", body: JSON.stringify({ name: "Seaters", looks: LOOKS }) });
  const dana = `dana${t}@x.com`;
  const member = await account(dana);
  const checksLeft = async () => (await member("/api/me")).j.user.plan.checksLeft;
  const settled = async (id) => { for (let w = 0; w < 60 && (await member(`/api/shoots/${id}`)).j.shoot.status === "checking"; w++) await new Promise((r) => setTimeout(r, 250)); };
  await admin3("/api/team/invites", { method: "POST", body: JSON.stringify({ emails: dana }) });
  const inv = (await admin3("/api/team")).j.team.members.find((m) => m.email === dana);
  const link = (await admin3(`/api/team/invites/${inv.id}/link`)).j.link;
  const seat = (await member(`/api/join/${tokenOf(link)}`, { method: "POST" })).j.shootId;
  await member(`/api/shoots/${seat}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(22) }) });
  const before = await checksLeft();
  const first = await member(`/api/shoots/${seat}/check`, { method: "POST", body: "{}" });
  await settled(seat);
  ok("checking a paid team seat doesn't spend the member's free checks", [200, 202].includes(first.status) && (await checksLeft()) === before, `${first.status} ${before} -> ${await checksLeft()}`);
  // Dana then uses up her free checks on a draft of her own.
  const own = (await member("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  await member(`/api/shoots/${own}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(21) }) });
  let last;
  for (let i = 0; i < 7; i++) {
    last = await member(`/api/shoots/${own}/check`, { method: "POST", body: "{}" });
    await settled(own);
  }
  // Her own free shoot isn't used yet, so a seventh comes from the daily
  // allowance before the free shoot (check-gate-tests.js), not her free checks.
  ok("her own seventh check comes from the daily allowance, not her free checks", last.status === 200 && (await checksLeft()) === 0, `${last.status} ${JSON.stringify(last.j?.error)}`);
  const again = await member(`/api/shoots/${seat}/check`, { method: "POST", body: "{}" });
  await settled(seat);
  ok("the paid team seat can still be checked", [200, 202].includes(again.status), `${again.status} ${JSON.stringify(again.j)}`);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
