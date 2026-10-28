// DEV/QA ONLY — customer results (lib/showcase.js): offering a headshot needs
// permission, nothing shows until an owner approves it, and taking it down,
// deleting the shoot or deleting the account removes it.
// Run against a local server wired to scripts/dev/mock-ai.js, with
// SHOWCASE_OWNER (default showcase-owner@example.com) in OWNER_EMAILS:
//   node scripts/dev/showcase-tests.js
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";
const B = process.env.BASE || "http://localhost:3100", M = process.env.MOCK || "http://localhost:4010";
const OWNER = process.env.SHOWCASE_OWNER || "showcase-owner@example.com";
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
async function account(email, name = "Dana Reyes") {
  const f = client();
  const up = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password: "password123" }) });
  if (up.status !== 201) await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
  else await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: await verifyToken(email) }) });
  return f;
}
const photo = async (i) => "data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("sc" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64");
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
// Pays on the stand-in Stripe page (a free shoot's headshots can only be
// shared once the account has bought a package: lib/preview.js).
async function buy(f, packageId = "starter") {
  const { j } = await f("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId }) });
  const id = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${id}?promo=FREE`, { redirect: "manual" });
  return (await f("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: id }) })).j;
}
const anon = client();
const shown = async () => (await anon("/api/showcase")).j.entries.map((e) => e.id);
const offer = (f, s, shot, extra = {}) => f("/api/showcase", { method: "POST", body: JSON.stringify({ shootId: s.id, shotId: shot.id, name: "Dana", role: "Realtor", quote: "Used it on my listings <b>the same day</b>.", consent: true, ...extra }) });
const t = Date.now();

const owner = await account(OWNER, "Owner");
const dana = await account(`dana${t}@x.com`);
const shoot = await doneShoot(dana);
// A free preview can't be shared until the account buys a package.
ok("a free preview can't be shared", (await offer(dana, shoot, shoot.shots.find((x) => x.status === "done"))).status === 402);
await buy(dana);
const [shotA, shotB] = shoot.shots.filter((x) => x.status === "done");
const before = await shown();

// 0. "Your headshots are ready" goes out once when a shoot finishes, and not
// again after a regrade.
{
  const ready = async () => (await mails()).filter((m) => m.to.includes(`dana${t}@x.com`) && m.subject === "Your headshots are ready");
  await new Promise((r) => setTimeout(r, 500));
  const first = await ready();
  ok("a ready email is sent when the shoot finishes", first.length === 1 && first[0].links.some((l) => l.endsWith(`/app/shoot/${shoot.id}`)), JSON.stringify(first.map((m) => m.links)));
  await dana(`/api/shoots/${shoot.id}/review`, { method: "POST", body: "{}" });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if ((await dana(`/api/shoots/${shoot.id}`)).j.shoot.status === "done") break;
  }
  ok("a regrade doesn't send it again", (await ready()).length === 1);
}

// 1. Offering needs permission, one of your own finished headshots, and a name.
let entry;
{
  ok("permission is required", (await offer(dana, shoot, shotA, { consent: undefined })).status === 400);
  ok("a name is required", (await offer(dana, shoot, shotA, { name: "  " })).status === 400);
  ok("a name can't carry a link or address", (await offer(dana, shoot, shotA, { name: "Ira http://x.y" })).status === 400 && (await offer(dana, shoot, shotA, { name: "ira@x.y" })).status === 400 && (await offer(dana, shoot, shotA, { name: "evil.com" })).status === 400 && (await offer(dana, shoot, shotA, { name: "ｗｗｗ.evil.example" })).status === 400);
  ok("it must be a finished headshot of the shoot", (await offer(dana, shoot, { id: "shot_nope" })).status === 400);
  const other = await account(`other${t}@x.com`);
  ok("someone else's shoot can't be offered", (await offer(other, shoot, shotA)).status === 404);
  const mailsBefore = (await mails()).length;
  const r = await offer(dana, shoot, shotA);
  entry = r.j?.entry;
  ok("an offer is saved for review", r.status === 200 && entry?.status === "pending" && entry.name === "Dana" && entry.role === "Realtor", JSON.stringify(r.j));
  ok("markup is stripped from the quote", entry && !/[<>]/.test(entry.quote) && entry.quote.includes("the same day"), entry?.quote);
  ok("the customer sees it on their account", (await dana("/api/showcase/mine")).j.entry?.id === entry.id);
  await new Promise((r) => setTimeout(r, 300));
  ok("the owner is told about it", (await mails()).slice(mailsBefore).some((m) => m.subject.startsWith("[Customer results]") && m.links.some((l) => l.endsWith("/app/showcase"))));
}

// 2. Nothing is public until it's approved.
{
  ok("not shown before approval", !(await shown()).includes(entry.id));
  ok("its image is hidden from the public", (await anon(`/showcase/${entry.id}.webp`)).status === 404);
  ok("but visible to the customer", (await dana(`/showcase/${entry.id}.webp`)).status === 200);
  ok("and to the owner", (await owner(`/showcase/${entry.id}.webp`)).status === 200);
  ok("only owners can review", (await dana("/api/owner/showcase")).status === 404 && (await dana(`/api/owner/showcase/${entry.id}`, { method: "POST", body: JSON.stringify({ status: "approved" }) })).status === 404);
  const list = (await owner("/api/owner/showcase")).j.entries;
  ok("the owner sees it with the customer's email", list.some((e) => e.id === entry.id && e.email === `dana${t}@x.com`));
}

// 3. Approved: shown on the home page, image public (briefly cached).
{
  const r = await owner(`/api/owner/showcase/${entry.id}`, { method: "POST", body: JSON.stringify({ status: "approved" }) });
  ok("the owner approves it", r.status === 200 && r.j.entry.status === "approved");
  const pub = (await anon("/api/showcase")).j.entries.find((e) => e.id === entry.id);
  ok("it's on the public list", !!pub && pub.name === "Dana" && !("userId" in pub) && !("email" in pub), JSON.stringify(pub));
  const img = (await anon(`/showcase/${entry.id}.webp?w=600`)).r;
  ok("its image is public", img.status === 200 && img.headers.get("content-type") === "image/webp" && /s-maxage=600/.test(img.headers.get("cache-control")), img.headers.get("cache-control"));
  const rej = await owner(`/api/owner/showcase/${entry.id}`, { method: "POST", body: JSON.stringify({ status: "rejected" }) });
  ok("the owner can stop showing it", rej.j.entry.status === "rejected" && !(await shown()).includes(entry.id) && (await anon(`/showcase/${entry.id}.webp`)).status === 404);
  await owner(`/api/owner/showcase/${entry.id}`, { method: "POST", body: JSON.stringify({ status: "approved" }) });
}

// 4. Offering another headshot replaces the first, which comes down.
{
  const r = await offer(dana, shoot, shotB ?? shotA, { quote: "" });
  ok("a new offer replaces the old one", r.status === 200 && r.j.entry.id !== entry.id && (await dana("/api/showcase/mine")).j.entry.id === r.j.entry.id);
  ok("the old one is gone", !(await shown()).includes(entry.id) && (await anon(`/showcase/${entry.id}.webp`)).status === 404);
  entry = r.j.entry;
}

// 5. Taking it down, deleting the shoot or the account removes it.
{
  const d = await dana("/api/showcase/mine", { method: "DELETE" });
  ok("the customer can take it down", d.status === 200 && (await dana("/api/showcase/mine")).j.entry === null && !(await owner("/api/owner/showcase")).j.entries.some((e) => e.id === entry.id));

  const r = await offer(dana, shoot, shotA);
  await owner(`/api/owner/showcase/${r.j.entry.id}`, { method: "POST", body: JSON.stringify({ status: "approved" }) });
  ok("(approved again)", (await shown()).includes(r.j.entry.id));
  await dana(`/api/shoots/${shoot.id}`, { method: "DELETE" });
  ok("deleting the shoot removes it", !(await shown()).includes(r.j.entry.id) && (await dana("/api/showcase/mine")).j.entry === null);

  const lee = await account(`lee${t}@x.com`, "Lee Park");
  const s2 = await doneShoot(lee);
  await buy(lee);
  // A form submitted twice in the same moment still leaves one entry.
  const leeShot = s2.shots.find((x) => x.status === "done");
  const [p, q] = await Promise.all([offer(lee, s2, leeShot, { name: "Lee" }), offer(lee, s2, leeShot, { name: "Lee" })]);
  const leeEntries = (await owner("/api/owner/showcase")).j.entries.filter((e) => e.email === `lee${t}@x.com`);
  const r2 = { j: { entry: (await lee("/api/showcase/mine")).j.entry } };
  ok("two offers at once leave one entry", p.status === 200 && q.status === 200 && leeEntries.length === 1 && r2.j.entry && leeEntries[0].id === r2.j.entry.id, JSON.stringify({ p: p.status, q: q.status, entries: leeEntries.length }));
  await owner(`/api/owner/showcase/${r2.j.entry.id}`, { method: "POST", body: JSON.stringify({ status: "approved" }) });
  await lee("/api/account/delete", { method: "POST", body: JSON.stringify({ password: "password123" }) });
  ok("deleting the account removes it", !(await shown()).includes(r2.j.entry.id) && (await anon(`/showcase/${r2.j.entry.id}.webp`)).status === 404);
  ok("the public list is back as it was", JSON.stringify(await shown()) === JSON.stringify(before));
}

// 5b. A refunded package takes down a headshot from a shoot it paid for.
{
  const rae = await account(`rae${t}@x.com`, "Rae Kim");
  const { j } = await rae("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
  const sid = new URL(j.url).pathname.split("/").pop();
  await fetch(`${M}/mock-pay/${sid}`, { redirect: "manual" }); // paid in full, so it can be refunded
  await rae("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid }) });
  await doneShoot(rae); // the free preview goes first
  const paid = await doneShoot(rae); // then a shoot from the package
  const r = await offer(rae, paid, paid.shots.find((x) => x.status === "done"), { name: "Rae" });
  ok("a headshot from a paid shoot can be offered", r.status === 200 && paid.paidWith === "credit", `${r.status} ${paid.paidWith}`);
  await fetch(`${M}/mock-refund/${sid}`);
  const synced = (await rae("/api/billing/sync", { method: "POST", body: "{}" })).j;
  ok("refunding the package takes it down", synced.user.purchased === false && (await rae("/api/showcase/mine")).j.entry === null && (await rae(`/showcase/${r.j.entry.id}.webp`)).status === 404, JSON.stringify({ purchased: synced.user?.purchased }));
}

// 5c. With two packages, refunding one only takes down what that one paid
// for (credits are spent oldest package first).
{
  const kai = await account(`kai${t}@x.com`, "Kai Moe");
  const pay = async () => {
    const { j } = await kai("/api/billing/checkout", { method: "POST", body: JSON.stringify({ packageId: "starter" }) });
    const sid = new URL(j.url).pathname.split("/").pop();
    await fetch(`${M}/mock-pay/${sid}`, { redirect: "manual" });
    await kai("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId: sid }) });
    return sid;
  };
  const first = await pay();
  await new Promise((r) => setTimeout(r, 20));
  const second = await pay();
  await doneShoot(kai); // the free preview
  const paid = await doneShoot(kai); // a credit from the first package
  const r = await offer(kai, paid, paid.shots.find((x) => x.status === "done"), { name: "Kai $` Moe", quote: "Great $' service" });
  ok("a shoot records the package that paid for it", r.status === 200 && paid.paidBy === first, `${paid.paidBy} vs ${first}`);
  // Approved, it's in the home page's own HTML, so search engines see it.
  await owner(`/api/owner/showcase/${r.j.entry.id}`, { method: "POST", body: JSON.stringify({ status: "approved" }) });
  const page = await (await fetch(`${B}/`)).text();
  ok("the home page carries the approved customer headshots", page.includes(`/showcase/${r.j.entry.id}.webp`) && page.includes("Real customers.") && page.includes("Kai $` Moe"), page.match(/id="customers"[^>]*>/)?.[0]);
  ok("a $ in a customer's words can't paste the page into itself", (page.match(/<!doctype html>/gi) || []).length === 1 && page.includes("Great $&#39; service"), `${(page.match(/<!doctype html>/gi) || []).length} doctypes, ${page.length} bytes`);
  await fetch(`${M}/mock-refund/${second}`);
  await kai("/api/billing/sync", { method: "POST", body: "{}" });
  ok("refunding the other package leaves it up", (await kai("/api/showcase/mine")).j.entry?.id === r.j.entry.id);
  await fetch(`${M}/mock-refund/${first}`);
  await kai("/api/billing/sync", { method: "POST", body: "{}" });
  ok("refunding the package that paid for it takes it down", (await kai("/api/showcase/mine")).j.entry === null);
}

// 6. The demo account can't offer anything.
{
  const demo = client();
  await demo("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: "demo@keeperheadshots.com", password: "studio-demo" }) });
  ok("the demo account can't share", (await demo("/api/showcase", { method: "POST", body: JSON.stringify({ shootId: "sht_whatever1", shotId: "x", name: "Demo", consent: true }) })).status === 403);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
