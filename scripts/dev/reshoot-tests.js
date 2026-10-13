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
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: await verifyToken(email) }) });
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
  const tooMany = await f(`/api/shoots/${rid}/generate`, { method: "POST", body: JSON.stringify({ looks: [...LOOKS, { backdrop: "studio-gray", outfit: "charcoal-blazer" }] }) });
  ok("more looks than the original's are refused", tooMany.status === 400 && tooMany.j.code === "too_many_looks", `${tooMany.status} ${tooMany.j?.code}`);
  const gen = await f(`/api/shoots/${rid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS }) });
  ok("the reshoot develops", gen.status === 202, `${gen.status} ${gen.j?.error || ""}`);
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
  await h(`/api/shoots/${rid}/check`, { method: "POST", body: "{}" });
  const afterFourth = await left();
  ok("a reshoot's first 3 checks are free", afterFree === start, `${start} → ${afterFree}`);
  ok("a 4th counts as usual", afterFourth === start - 1, `${afterFree} → ${afterFourth}`);
  await h(`/api/shoots/${sid}`, { method: "DELETE" });
  const orphan = (await h(`/api/shoots/${rid}`)).j.shoot;
  ok("deleting the original makes its reshoot an ordinary shoot", !orphan.reshootOf && !orphan.reshootLooks);
  const gen = await h(`/api/shoots/${rid}/generate`, { method: "POST", body: JSON.stringify({ looks: LOOKS.slice(0, 1) }) });
  ok("which develops like any other (here: no shoots left, so it asks to buy)", gen.status === 402 && !/reshoot/i.test(gen.j?.error || ""), `${gen.status} ${gen.j?.error}`);
}

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
