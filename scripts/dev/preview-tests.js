// DEV/QA ONLY — the free preview (lib/preview.js) and the owner's tools
// (lib/outreach.js): a free shoot's headshots are watermarked and smaller
// until the account buys a package; selfies never are; the owner can list
// customer shoots and send a one-time offer email.
// Run against a local server wired to scripts/dev/mock-ai.js, with
// PREVIEW_OWNER (default preview-owner@example.com) in OWNER_EMAILS:
//   node scripts/dev/preview-tests.js
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
import { reminderEmail, offerEmail } from "../../lib/mail.js";
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const OWNER = process.env.PREVIEW_OWNER || "preview-owner@example.com";
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
    return { status: r.status, j, r };
  };
}
const mails = () => fetch(`${M}/mock-mail`).then((r) => r.json());
const verifyToken = async (email) => new URL((await mails()).filter((m) => m.to.includes(email.toLowerCase())).flatMap((m) => m.links).findLast((l) => l.includes("/verify?token="))).searchParams.get("token");
async function account(email, name = "Pat Lee", verify = true) {
  const f = client();
  const up = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password: "password123" }) });
  if (up.status !== 201) await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
  else if (verify) await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email) }) });
  return f;
}
async function buy(f, packageId = "starter", shootId) {
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId, shootId }) });
  const id = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${id}?promo=FREE`, { redirect: "manual" });
  return (await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: id }) })).j;
}
const photo = async (i) => "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("pv" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
async function doneShoot(f) {
  const id = (await f("/api/shoots", { method: "POST", body: "{}" })).j.shoot.id;
  for (let i = 0; i < 2; i++) await f(`/api/shoots/${id}/selfies`, { method: "POST", body: JSON.stringify({ photo: await photo(i) }) });
  await f(`/api/shoots/${id}/check`, { method: "POST", body: "{}" });
  await f(`/api/shoots/${id}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }] }) });
  let s;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    s = (await f(`/api/shoots/${id}`)).j.shoot;
    if (!["generating", "reviewing"].includes(s.status)) break;
  }
  if (s.status !== "done") throw new Error(`shoot didn't develop: ${s.status}`);
  return s;
}
const get = async (f, path) => {
  const { r } = await f(path);
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf, cache: r.headers.get("cache-control") || "", disp: r.headers.get("content-disposition") || "", meta: r.status === 200 ? await sharp(buf).metadata() : null };
};
const t = Date.now();

// 0. Email copy.
{
  const e = reminderEmail({ kind: "buy", name: "Pat", link: "L", pricing: "P", unsubscribe: "U", preview: true });
  ok("the 'buy' reminder for a preview offers to keep it, without mentioning a watermark", /\$9/.test(e.subject + e.text) && /\$15/.test(e.text) && !/watermark/i.test(e.subject + e.text + e.html));
  const o = offerEmail({ name: "Pat Lee", code: "KEEP30", discount: "30% off", until: "Sunday", link: "L", pricing: "P", usedFree: true, preview: true, unsubscribe: "U" });
  ok("the offer email has the code, the discount and the unsubscribe link", o.text.includes("KEEP30") && o.text.includes("30% off any package until Sunday") && o.text.includes("U") && o.html.includes("KEEP30"));
  ok("and doesn't mention a watermark", !/watermark/i.test(o.subject + o.text + o.html));
}

const owner = await account(OWNER, "Owner");
const pat = await account(`pat${t}@x.com`);
const shoot = await doneShoot(pat);
const shot = shoot.shots.find((x) => x.status === "done");
const file = `/media/${shot.file}`;
let previewBytes = 0;

// 1. A free shoot is a preview: watermarked, smaller, not cached for long.
{
  ok("a new free shoot is marked as a preview", shoot.preview === true && shoot.paidWith === "free");
  ok("the account hasn't bought anything", (await pat("/api/me")).j?.user?.purchased === false);
  const img = await get(pat, file);
  previewBytes = img.buf.length;
  ok("the headshot is served at most 1024 px", img.status === 200 && Math.max(img.meta.width, img.meta.height) <= 1024, `${img.meta?.width}x${img.meta?.height}`);
  ok("and not cached for long", /no-cache/.test(img.cache), img.cache);
  const dl = await get(pat, `${file}?download=1`);
  ok("a download is named as a preview", /headshot-preview-/.test(dl.disp), dl.disp);
  const sq = await get(pat, `${file}?square=1`);
  ok("the square is watermarked too", sq.status === 200 && sq.meta.width <= 1024 && /no-cache/.test(sq.cache));
  const sig = await get(pat, `${file}?size=signature`);
  ok("so is the email-signature size", sig.status === 200 && sig.meta.format === "png" && sig.meta.width === 256);
  const selfie = await get(pat, `/media/${shoot.selfies[0].file}`);
  ok("selfies are never watermarked", selfie.status === 200 && /immutable/.test(selfie.cache), selfie.cache);
  const share = await pat("/api/showcase", { method: "POST", body: JSON.stringify({ shootId: shoot.id, shotId: shot.id, name: "Pat", consent: true }) });
  ok("a preview can't be shared to the home page", share.status === 402 && share.j?.code === "preview");
}

// 2. The owner's shoot list and offer (before Pat buys).
{
  ok("only owners can list shoots", (await pat("/api/owner/shoots")).status === 404);
  const r = (await owner("/api/owner/shoots?days=7")).j;
  const row = r?.shoots?.find((x) => x.id === shoot.id);
  ok("the owner sees the shoot", !!row && row.paidWith === "free" && row.preview === true && row.done >= 1 && /^p\*\*\*@/.test(row.email), JSON.stringify(row));
  ok("its download is recorded", !!row?.downloaded);
  ok("with a summary", r.summary.free >= 1 && r.summary.freeFinished >= 1);
  ok("only owners can send offers", (await pat("/api/owner/offer", { method: "POST", body: JSON.stringify({ code: "KEEP30" }) })).status === 404);
  ok("a code is required", (await owner("/api/owner/offer", { method: "POST", body: JSON.stringify({ code: "x" }) })).status === 400);
  const code = `KEEP${String(t).slice(-6)}`;
  const count = (await owner("/api/owner/offer", { method: "POST", body: JSON.stringify({ code }) })).j;
  ok("counting finds people who haven't bought", count.eligible >= 1 && count.sent === 0, JSON.stringify(count));
  const before = (await mails()).length;
  const sent = (await owner("/api/owner/offer", { method: "POST", body: JSON.stringify({ code, discount: "30% off", until: "Sunday", send: true }) })).j;
  await new Promise((r) => setTimeout(r, 300));
  const mine = (await mails()).slice(before).filter((m) => m.to.includes(`pat${t}@x.com`));
  ok("the offer reaches them once", sent.sent >= 1 && mine.length === 1 && mine[0].subject === "How did your headshots turn out?", JSON.stringify(sent));
  const again = (await owner("/api/owner/offer", { method: "POST", body: JSON.stringify({ code, send: true }) })).j;
  await new Promise((r) => setTimeout(r, 300));
  ok("and never twice with the same code", (await mails()).filter((m) => m.to.includes(`pat${t}@x.com`) && m.subject === "How did your headshots turn out?").length === 1 && again.sent === 0, JSON.stringify(again));
  const owners = (await mails()).slice(before).filter((m) => m.to.includes(OWNER));
  ok("owners don't get offers", owners.length === 0);
}

// 3. Buying any package unlocks the free shoot: the clean original.
{
  await buy(pat);
  ok("the account has bought", (await pat("/api/me")).j?.user?.purchased === true);
  const img = await get(pat, file);
  ok("the headshot is now the original, not the preview", img.status === 200 && img.buf.length !== previewBytes, `${img.meta?.width}x${img.meta?.height}`);
  ok("and cached normally", /immutable/.test(img.cache), img.cache);
  const dl = await get(pat, `${file}?download=1`);
  ok("downloads drop the preview name", !/preview/.test(dl.disp), dl.disp);
  const count = (await owner("/api/owner/offer", { method: "POST", body: JSON.stringify({ code: `NEW${String(t).slice(-6)}` }) })).j;
  const row = (await owner("/api/owner/shoots?days=7")).j.shoots.find((x) => x.id === shoot.id);
  ok("buyers don't get offers, and show as bought", row?.bought === true && row.preview === false && count.eligible >= 0);
}

// 4. The preview offers: keep one shoot ($9), or keep it and add 2 looks
// ($15). Bought for one finished preview of your own.
{
  const kim = await account(`kim${t}@x.com`, "Kim Park");
  const prev = await doneShoot(kim);
  const kimFile = `/media/${prev.shots.find((x) => x.status === "done").file}`;
  const start = (body) => kim("/api/billing/checkout", { method: "POST", body: JSON.stringify(body) });
  ok("an offer needs a shoot", (await start({ packageId: "keep" })).status === 400);
  ok("not someone else's", (await start({ packageId: "keep", shootId: shoot.id })).status === 400);
  ok("not one that's already unlocked", (await pat("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "keep", shootId: shoot.id }) })).status === 400);
  const c = await start({ packageId: "keep-plus", shootId: prev.id });
  ok("a preview offer starts checkout at its price", c.status === 200 && c.j.value === 15, JSON.stringify(c.j));
  // Stripe sends the buyer back to the shoot.
  const sid = new URL(c.j.url).pathname.split("/").pop();
  const back = await fetch(`${M}/mock-pay/${sid}`, { redirect: "manual" });
  ok("and returns to that shoot", (back.headers.get("location") || "").includes(`/app/shoot/${prev.id}?checkout=success`), back.headers.get("location"));
  const conf = (await kim("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid }) })).j;
  ok("paying unlocks it, with 2 looks to add, and no shoot credits", conf.granted === true && conf.added === 0 && conf.packageId === "keep-plus" && conf.value === 15 && conf.user.purchased === true && conf.user.extraLooks[prev.id] === 2 && conf.user.plan.credits === 0, JSON.stringify({ ...conf, user: { extraLooks: conf.user?.extraLooks, credits: conf.user?.plan?.credits } }));
  const again = (await kim("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid }) })).j;
  ok("confirming twice grants once", again.granted === false && again.user.extraLooks[prev.id] === 2);
  const img = await get(kim, kimFile);
  ok("the headshots are now the originals", img.status === 200 && /immutable/.test(img.cache));
  ok("the shoot can't be kept twice", (await start({ packageId: "keep", shootId: prev.id })).status === 400);
  const add = (looks) => kim(`/api/shoots/${prev.id}/more-looks`, { method: "POST", body: JSON.stringify({ looks }) });
  ok("extra looks can't repeat one the shoot has", (await add([{ backdrop: "studio-gray", outfit: "navy-suit" }])).status === 400);
  ok("or be more than were bought", (await add([{ backdrop: "glass-office", outfit: "navy-suit" }, { backdrop: "studio-gray", outfit: "white-shirt" }, { backdrop: "glass-office", outfit: "white-shirt" }])).status === 400);
  ok("and only the owner adds them", (await pat(`/api/shoots/${prev.id}/more-looks`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "glass-office", outfit: "navy-suit" }] }) })).status === 404);
  const r = await add([{ backdrop: "glass-office", outfit: "navy-suit" }, { backdrop: "studio-gray", outfit: "white-shirt" }]);
  ok("2 new looks are added and developed", r.status === 202 && r.j.shoot.looks.length === 3 && r.j.shoot.shots.length === 6 && r.j.user.extraLooks[prev.id] === undefined, `${r.status} ${JSON.stringify(r.j?.error || r.j?.shoot?.looks)}`);
  ok("they can't be added twice", (await add([{ backdrop: "glass-office", outfit: "white-shirt" }])).status === 400);
  let s;
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    s = (await kim(`/api/shoots/${prev.id}`)).j.shoot;
    if (!["generating", "reviewing"].includes(s.status)) break;
  }
  ok("the shoot finishes with all its headshots", s.status === "done" && s.shots.filter((x) => x.status === "done").length === 6 && s.shots.slice(0, 2).every((x, i) => x.file === prev.shots[i].file), `${s.status} ${s.shots.filter((x) => x.status === "done").length}`);

  const lee = await account(`lee${t}@x.com`, "Lee Ray");
  const leeShoot = await doneShoot(lee);
  const k = await buy(lee, "keep", leeShoot.id);
  ok("'Keep your preview' unlocks it with no looks to add", k.granted === true && k.user.purchased === true && !k.user.extraLooks[leeShoot.id], JSON.stringify(k.user?.extraLooks));
  ok("and nothing to add", (await lee(`/api/shoots/${leeShoot.id}/more-looks`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "glass-office", outfit: "navy-suit" }] }) })).status === 400);
}

// 5. A paid shoot is never a preview.
{
  const paid = await doneShoot(pat);
  ok("a shoot paid with a credit isn't a preview", !paid.preview && paid.paidWith === "credit");
}

const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
