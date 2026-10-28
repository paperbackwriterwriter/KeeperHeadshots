// DEV/QA ONLY — the site-wide render limit (lib/slots.js): several shoots
// developing at once, polled through two servers, never have more than
// RENDER_SLOTS frame renders running together, and all still finish.
// Servers on :3100/:3101 with RENDER_SLOTS=3 and SLOTS_OWNER (default
// slots-owner@example.com) in OWNER_EMAILS; the mock's output in MOCKLOG:
//   MOCKLOG=/path/to/mock.log node scripts/dev/slots-test.js
import fs from "node:fs";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const SERVERS = (process.env.SERVERS || "http://localhost:3100,http://localhost:3101").split(",");
const M = process.env.MOCK || "http://localhost:4010";
const SLOTS = Number(process.env.RENDER_SLOTS || 3);
const OWNER = process.env.SLOTS_OWNER || "slots-owner@example.com";
const MOCKLOG = process.env.MOCKLOG;
if (!MOCKLOG) throw new Error("Set MOCKLOG to the mock's log file.");
let cookie = "";
const f = async (p, o = {}, base = SERVERS[0]) => {
  const r = await fetch(base + p, { ...o, headers: { "content-type": "application/json", cookie } });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: r.status, j: await r.json().catch(() => null) };
};

const up = await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Slots Test", email: OWNER, password: "password123" }) });
if (up.status === 201) {
  const mail = await fetch(`${M}/mock-mail`).then((r) => r.json());
  const link = mail.filter((m) => m.to.includes(OWNER)).flatMap((m) => m.links).find((l) => l.includes("/verify?token="));
  await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ created: true, token: new URL(link).searchParams.get("token") }) });
} else await f("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: OWNER, password: "password123" }) });

const photos = [];
for (let i = 0; i < 3; i++) photos.push("data:image/jpeg;base64," + (await sharp(Buffer.from(portraitSVG("sl" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer()).toString("base64"));
const ids = [];
for (let i = 0; i < 3; i++) {
  const { j } = await f("/api/shoots", { method: "POST", body: "{}" });
  for (const photo of photos) await f(`/api/shoots/${j.shoot.id}/selfies`, { method: "POST", body: JSON.stringify({ photo }) });
  await f(`/api/shoots/${j.shoot.id}/check`, { method: "POST" });
  ids.push(j.shoot.id);
}
const before = fs.readFileSync(MOCKLOG, "utf8").length;
for (const id of ids) await f(`/api/shoots/${id}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "library", outfit: "camel-knit" }] }) });

let shoots = [];
let sawQueued = false;
for (let i = 0; i < 600; i++) {
  const polls = ids.flatMap((id) => SERVERS.map((base) => f(`/api/shoots/${id}`, {}, base)));
  const got = (await Promise.all(polls)).map((r) => r.j?.shoot).filter(Boolean);
  if (got.some((s) => s.queued)) sawQueued = true;
  shoots = ids.map((id) => got.find((s) => s.id === id));
  if (shoots.every((s) => s && !["generating", "reviewing"].includes(s.status))) break;
  await new Promise((r) => setTimeout(r, 300));
}
await new Promise((r) => setTimeout(r, 1500));
const log = fs.readFileSync(MOCKLOG, "utf8").slice(before).split("\n").filter((l) => /generateContent/.test(l) && /refs=[2-9]/.test(l));
const maxRenders = Math.max(0, ...log.map((l) => Number(/renders=(\d+)/.exec(l)?.[1] || 0)));
const frames = shoots.reduce((n, s) => n + s.shots.length, 0);
const done = shoots.reduce((n, s) => n + s.shots.filter((x) => x.status === "done").length, 0);
const result = { shoots: shoots.map((s) => s.status), frames, done, renderCalls: log.length, maxRenders, slots: SLOTS, sawQueued };
console.log(JSON.stringify(result));
// All frames developed, each once; never more than SLOTS at a time, and the
// limit was actually reached (3 shoots × 2 per shoot = 6 wanted).
const passed = shoots.every((s) => s.status === "done") && done === frames && log.length === frames && maxRenders <= SLOTS && maxRenders === SLOTS;
console.log(passed ? "PASS site-wide render limit" : "FAIL site-wide render limit");
process.exit(passed ? 0 : 1);
