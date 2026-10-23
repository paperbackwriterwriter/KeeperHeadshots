// DEV/QA ONLY — customers pay up front (lib/plan.js FREE_SHOOT_OFFERED off):
// a new account gets no free shoot and needn't confirm its email; it buys a
// package first, then creates, checks and develops a full shoot (4 looks, 8
// headshots, no watermark). Previews people already have can still be kept
// ($8.99 / $14.99).
// Run against a local server wired to scripts/dev/mock-ai.js WITHOUT
// FREE_SHOOT_OFFERED (BASE), plus one with FREE_SHOOT_OFFERED=1 on the same
// store and SESSION_SECRET (PREVIEW_BASE), which makes the earlier previews:
//   BASE=http://localhost:3102 PREVIEW_BASE=http://localhost:3100 node scripts/dev/pay-first-tests.js
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
import { verificationEmail, reminderEmail, offerEmail } from "../../lib/mail.js";
import { FREE_SHOOT_OFFERED } from "../../lib/plan.js";

const B = process.env.BASE || "http://localhost:3102";
const PB = process.env.PREVIEW_BASE || "http://localhost:3100";
const M = process.env.MOCK || "http://localhost:4010";
const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const FREE_WORDS = /free (preview|shoot|headshot)|first shoot is free|try it free|unlock your free/i;

// One signed-in browser; `base` picks the server (both share the store and
// the session secret, so the same cookie works on either).
function client() {
  let cookie = "";
  const f = async (p, o = {}, base = B) => {
    const r = await fetch(base + p, { redirect: "manual", ...o, headers: { "content-type": "application/json", cookie, ...(o.headers || {}) } });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let j = null;
    try { j = await r.clone().json(); } catch {}
    return { status: r.status, j, r };
  };
  return f;
}
const mails = () => fetch(`${M}/mock-mail`).then((r) => r.json());
const verifyToken = async (email) => new URL((await mails()).filter((m) => m.to.includes(email.toLowerCase())).flatMap((m) => m.links).findLast((l) => l.includes("/verify?token="))).searchParams.get("token");
async function account(email, name, { verify = false, base = B } = {}) {
  const f = client();
  const up = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password: "password123" }) }, base);
  if (up.status !== 201) throw new Error(`signup ${up.status} ${JSON.stringify(up.j)}`);
  if (verify) await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email) }) }, base);
  return f;
}
async function pay(f, body) {
  const c = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify(body) });
  if (c.status !== 200) return { checkout: c };
  const id = new URL(c.j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${id}?promo=FREE`, { redirect: "manual" });
  return { checkout: c, confirm: (await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: id }) })).j };
}
const photo = async (i) => "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("pf" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
async function waitDone(f, id, base = B) {
  let s;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    s = (await f(`/api/shoots/${id}`, {}, base)).j.shoot;
    if (!["generating", "reviewing"].includes(s.status)) break;
  }
  return s;
}
const LOOKS4 = [
  { backdrop: "studio-gray", outfit: "navy-suit" },
  { backdrop: "glass-office", outfit: "navy-suit" },
  { backdrop: "studio-gray", outfit: "white-shirt" },
  { backdrop: "glass-office", outfit: "white-shirt" },
];
const get = async (f, path) => {
  const { r } = await f(path);
  return { status: r.status, cache: r.headers.get("cache-control") || "", disp: r.headers.get("content-disposition") || "" };
};
const t = Date.now();

// 0. The switch, and copy that no longer promises a free shoot.
{
  ok("FREE_SHOOT_OFFERED is off in the code", FREE_SHOOT_OFFERED === false);
  const v = verificationEmail({ name: "Pat Lee", link: "https://x.test/verify?token=abc", code: "123456" });
  ok("the confirmation email doesn't mention a free shoot", !FREE_WORDS.test(v.subject + v.text + v.html) && /confirm your email address/i.test(v.text), v.text.split("\n")[2]);
  const d = reminderEmail({ kind: "develop", name: "Pat", link: "L", pricing: "P", unsubscribe: "U", needsPackage: true });
  ok("a checked-but-unpaid reminder invites them to choose a package", /choose a package/i.test(d.subject + d.text) && d.html.includes('href="P"') && !FREE_WORDS.test(d.subject + d.text + d.html), d.subject);
  const o = offerEmail({ name: "Pat Lee", code: "HELLO10", discount: "10% off", link: "P", pricing: "P", usedFree: false, unsubscribe: "U" });
  ok("the owner's offer to someone who never developed invites them to choose a package", /choose a package/i.test(o.text) && !FREE_WORDS.test(o.subject + o.text + o.html), o.subject);
}

// 1. Public pages: packages and the guarantee, no free preview, and no
// preview offers in the structured data.
{
  const home = await (await fetch(B + "/")).text();
  ok("the home page doesn't promise a free preview", !FREE_WORDS.test(home) && !/\$8\.99|14\.99/.test(home));
  ok("it leads pricing with the packages and the guarantee", /Pick a package and get up to 4 looks and 8 headshots in every shoot/.test(home) && /money-back/i.test(home));
  const ld = [...home.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  ok("structured data offers only the packages", /"price":"29"/.test(ld.replace(/\s/g, "")) && !/8\.99|14\.99/.test(ld), ld.match(/"price":\s*"[^"]+"/g)?.join(","));
  for (const p of ["/linkedin-headshots", "/real-estate-headshots", "/resume-headshots", "/doctor-headshots", "/lawyer-headshots", "/team-headshots", "/signup"]) {
    const h = await (await fetch(B + p)).text();
    ok(`${p} doesn't promise a free shoot`, !/free preview|try it free|first shoot is (a )?free|keep yours from \$8\.99/i.test(h));
  }
  const terms = await (await fetch(B + "/terms")).text();
  ok("the terms say new accounts don't get a free shoot", !/New accounts get one free shoot/.test(terms) && /New accounts no longer get a free shoot/.test(terms));
  const llms = await (await fetch(B + "/llms.txt")).text();
  ok("llms.txt doesn't promise a free preview", !FREE_WORDS.test(llms) && !/8\.99/.test(llms));
}

// 2. A new account, confirmed or not: no free shoot, nothing to confirm
// first, and no shoot until it buys a package.
const samEmail = `sam${t}@x.com`;
const sam = await account(samEmail, "Sam Pay");
{
  const me = (await sam("/api/me")).j.user;
  const p = me.plan;
  ok("a new account has tier none and can't develop", p.tier === "none" && p.canDevelop === false && p.credits === 0, JSON.stringify(p));
  ok("no free shoot, and confirming the email isn't asked for", p.freeShootAvailable === false && !p.needsEmail && me.emailVerified === false, JSON.stringify(p));
  ok("it's marked as a brand-new customer (not out of shoots)", p.started === false);
  const r = await sam("/api/shoots", { method: "POST", body: "{}" });
  ok("creating a shoot needs a package first (402), said as a first step, not 'out of shoots'", r.status === 402 && r.j?.code === "payment_required" && /Choose a package to start your first shoot/.test(r.j?.error || "") && !/out of shoots/.test(r.j?.error || ""), `${r.status} ${JSON.stringify(r.j)}`);
  const cleo = await account(`cleo${t}@x.com`, "Cleo Confirmed", { verify: true });
  const cp = (await cleo("/api/me")).j.user;
  ok("a confirmed new account gets no free shoot either", cp.emailVerified === true && cp.plan.tier === "none" && cp.plan.canDevelop === false && cp.plan.freeShootAvailable === false && !cp.plan.needsEmail, JSON.stringify(cp.plan));
  ok("and can't create a shoot", (await cleo("/api/shoots", { method: "POST", body: "{}" })).status === 402);
}

// 3. Sam (email never confirmed) buys Starter, then creates, uploads, checks
// and develops a full shoot: 4 looks, 8 headshots, no watermark.
{
  const { checkout, confirm } = await pay(sam, { packageId: "starter" });
  ok("an unconfirmed account can start checkout", checkout.status === 200 && checkout.j.value === 29, `${checkout.status} ${JSON.stringify(checkout.j)}`);
  ok("buying Starter adds 3 shoots", confirm?.granted === true && confirm.user.plan.tier === "paid" && confirm.user.plan.credits === 3 && confirm.user.plan.canDevelop === true && confirm.user.plan.started === true, JSON.stringify(confirm?.user?.plan));
  const c = await sam("/api/shoots", { method: "POST", body: "{}" });
  ok("then it can create a shoot", c.status === 201, `${c.status} ${JSON.stringify(c.j)}`);
  const id = c.j.shoot.id;
  let up = 0;
  for (let i = 0; i < 3; i++) up += (await sam(`/api/shoots/${id}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(i) }) })).status === 201 ? 1 : 0;
  ok("upload its selfies", up === 3);
  const chk = await sam(`/api/shoots/${id}/check`, { method: "POST", body: "{}" });
  ok("check its photos without confirming the email", chk.status === 200 && chk.j.shoot.status === "checked", `${chk.status} ${chk.j?.error || chk.j?.shoot?.status}`);
  const g = await sam(`/api/shoots/${id}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS4 }) });
  ok("and develop 4 looks", g.status === 202 && g.j.shoot.looks.length === 4 && g.j.shoot.shots.length === 8, `${g.status} ${g.j?.error || ""}`);
  const s = await waitDone(sam, id);
  ok("the shoot finishes with 8 headshots", s.status === "done" && s.shots.filter((x) => x.status === "done").length === 8, `${s.status} ${s.shots.filter((x) => x.status === "done").length}`);
  ok("paid with a credit, not a preview", !s.preview && s.paidWith === "credit", JSON.stringify({ preview: s.preview, paidWith: s.paidWith }));
  const file = `/media/${s.shots.find((x) => x.status === "done").file}`;
  const img = await get(sam, file);
  ok("its headshots are served clean (no watermark)", img.status === 200 && !/no-cache/.test(img.cache), img.cache);
  const dl = await get(sam, `${file}?download=1`);
  ok("and download without the preview name", dl.status === 200 && !/preview/.test(dl.disp), dl.disp);
  const me = (await sam("/api/me")).j.user;
  ok("one shoot used, two left", me.plan.credits === 2 && me.emailVerified === false, JSON.stringify(me.plan));
  await new Promise((r) => setTimeout(r, 500));
  const ready = (await mails()).filter((m) => m.to.includes(samEmail.toLowerCase()) && /headshots are ready/i.test(m.subject));
  ok("a paying customer who hasn't confirmed still gets the headshots-ready email", ready.length === 1, `${ready.length}`);
  // Invitations go out in the admin's name with their address to reply to,
  // so a team needs a confirmed address (shoots of their own don't).
  const early = await sam("/api/team", { method: "POST", body: JSON.stringify({ name: "Sam Co", looks: [LOOKS4[0]] }) });
  ok("an unconfirmed customer can't set up a team until they confirm their address", early.status === 403 && /Confirm your email address/.test(early.j?.error || ""), `${early.status} ${JSON.stringify(early.j?.error || "")}`);
  await sam("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(samEmail) }) });
  const team = await sam("/api/team", { method: "POST", body: JSON.stringify({ name: "Sam Co", looks: [LOOKS4[0]] }) });
  ok("once confirmed, they can", team.status === 200, `${team.status} ${JSON.stringify(team.j?.error || "")}`);
  // Buying more shoots from the team page comes back to the team page.
  const more = await sam("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter", returnTo: "team" }) });
  const sess = more.status === 200 ? new URL(more.j.url).pathname.split("/").pop() : "";
  const back = sess ? (await fetch(`${M}/mock-pay/${sess}?promo=FREE`, { redirect: "manual" })).headers.get("location") || "" : "";
  ok("a package bought from the team page returns to the team page", /\/app\/team\?checkout=success/.test(back), `${more.status} ${back}`);
}

// 3b. A draft made while free shoots were offered (or any draft on an account
// with no package) can't use photo checks: it couldn't be developed.
{
  const f = await account(`drafty${t}@x.com`, "Old Draft", { verify: true, base: PB });
  const id = (await f("/api/shoots", { method: "POST", body: "{}" }, PB)).j.shoot.id;
  await f(`/api/shoots/${id}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(8) }) }, PB);
  const check = await f(`/api/shoots/${id}/check`, { method: "POST", body: "{}" });
  ok("an account with no package can't run photo checks on an old draft", check.status === 402 && /Choose a package/.test(check.j?.error || ""), `${check.status} ${JSON.stringify(check.j?.error || "")}`);
}

// 4. An account that already has a finished free preview (made while free
// shoots were offered) keeps it as a preview and can still keep it for
// $8.99 or $14.99 on the pay-first server.
async function previewAccount(email, name) {
  const f = await account(email, name, { verify: true, base: PB });
  const id = (await f("/api/shoots", { method: "POST", body: "{}" }, PB)).j.shoot.id;
  for (let i = 0; i < 2; i++) await f(`/api/shoots/${id}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(i + 5) }) }, PB);
  await f(`/api/shoots/${id}/check`, { method: "POST", body: "{}" }, PB);
  await f(`/api/shoots/${id}/generate`, { method: "POST", body: JSON.stringify({ looks: [LOOKS4[0]] }) }, PB);
  const s = await waitDone(f, id, PB);
  if (s.status !== "done" || !s.preview) throw new Error(`preview didn't develop on ${PB}: ${s.status} preview=${s.preview}`);
  return { f, s };
}
{
  const { f: ivy, s } = await previewAccount(`ivy${t}@x.com`, "Ivy Preview");
  const p = (await ivy("/api/me")).j.user.plan;
  ok("someone with an earlier preview is out of shoots here, not a new customer", p.tier === "none" && p.started === true && p.freeShootAvailable === false && !p.needsEmail, JSON.stringify(p));
  const again = (await ivy(`/api/shoots/${s.id}`)).j.shoot;
  ok("their shoot is still a preview", again.preview === true && again.paidWith === "free");
  const shot = s.shots.find((x) => x.status === "done");
  const file = `/media/${shot.file}`;
  ok("still served watermarked", /no-cache/.test((await get(ivy, file)).cache));
  ok("and they still can't start a new shoot for free", (await ivy("/api/shoots", { method: "POST", body: "{}" })).status === 402);
  const { checkout, confirm } = await pay(ivy, { packageId: "keep", shootId: s.id, shotId: shot.id });
  ok("they can still buy Keep your pick ($8.99)", checkout.status === 200 && checkout.j.value === 8.99, `${checkout.status} ${JSON.stringify(checkout.j)}`);
  ok("which keeps that headshot", confirm?.granted === true && confirm.packageId === "keep" && (confirm.user.kept?.[s.id] || []).includes(shot.id), JSON.stringify({ granted: confirm?.granted, kept: confirm?.user?.kept }));

  const { f: max, s: ms } = await previewAccount(`max${t}@x.com`, "Max Preview");
  const plus = await pay(max, { packageId: "keep-plus", shootId: ms.id });
  ok("they can still buy Keep them all + 2 more looks ($14.99)", plus.checkout.status === 200 && plus.checkout.j.value === 14.99 && plus.confirm?.granted === true && plus.confirm.user.extraLooks[ms.id] === 2 && plus.confirm.user.previewsUnlocked === true, JSON.stringify(plus.confirm?.user?.extraLooks));
  ok("which unlocks the preview", !/no-cache/.test((await get(max, `/media/${ms.shots.find((x) => x.status === "done").file}`)).cache));
  const add = await max(`/api/shoots/${ms.id}/more-looks`, { method: "POST", body: JSON.stringify({ looks: [LOOKS4[1], LOOKS4[2]] }) });
  ok("and its 2 extra looks develop here", add.status === 202 && add.j.shoot.looks.length === 3, `${add.status} ${add.j?.error || ""}`);
  const done = await waitDone(max, ms.id);
  ok("the kept shoot finishes with 6 headshots", done.status === "done" && done.shots.filter((x) => x.status === "done").length === 6, `${done.status}`);
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
