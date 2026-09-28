// DEV/QA ONLY — checks that a shoot renders each frame once, and grades once,
// when several server instances poll it at the same time. Start two servers
// on the same DATA_DIR and SESSION_SECRET (ports 3100 and 3101), both wired to
// scripts/dev/mock-ai.js, with the mock's output going to MOCKLOG:
//   MOCKLOG=/path/to/mock.log node scripts/dev/render-race.js
// It counts the image renders and grading calls the mock received; with the
// mock started with MOCK_QA_FAIL=none, a correct run shows renderCalls equal
// to frames and exactly one reviewCall.
import fs from "node:fs";
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const SERVERS = (process.env.SERVERS || "http://localhost:3100,http://localhost:3101").split(",");
const MOCK = process.env.MOCK || "http://localhost:4010";
const MOCKLOG = process.env.MOCKLOG;
let cookie = "";
const f = async (p, o = {}, base = SERVERS[0]) => {
  const r = await fetch(base + p, { ...o, headers: { "content-type": "application/json", cookie } });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return r.json();
};
const mockLog = () => (MOCKLOG ? fs.readFileSync(MOCKLOG, "utf8") : "");

// EMAIL: an address listed in the servers' OWNER_EMAILS runs a full 4-look
// (8-frame) shoot instead of the free 2-look one, which races harder.
const email = process.env.EMAIL || `race${Date.now()}@x.com`;
await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Race Test", email, password: "password123" }) });
const mail = await fetch(`${MOCK}/mock-mail`).then((r) => r.json());
const link = mail.filter((m) => m.to.includes(email)).flatMap((m) => m.links).find((l) => l.includes("/verify?token="));
await f("/api/auth/verify", { method: "POST", body: JSON.stringify({ token: new URL(link).searchParams.get("token") }) });
const { shoot } = await f("/api/shoots", { method: "POST", body: "{}" });
for (let i = 0; i < 3; i++) {
  const b = await sharp(Buffer.from(portraitSVG("rr" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer();
  await f(`/api/shoots/${shoot.id}/selfies`, { method: "POST", body: JSON.stringify({ photo: "data:image/jpeg;base64," + b.toString("base64") }) });
}
await f(`/api/shoots/${shoot.id}/check`, { method: "POST" });

// The mock's in-flight counts cover every shoot, so let renders left over from
// earlier test suites finish before measuring this one.
for (let i = 0; i < 120; i++) {
  const { inflight } = await fetch(`${MOCK}/mock-inflight`).then((r) => r.json()).catch(() => ({ inflight: 0 }));
  if (!inflight) break;
  await new Promise((r) => setTimeout(r, 500));
}
const before = mockLog().length;
const g = await f(`/api/shoots/${shoot.id}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "library", outfit: "camel-knit" }, { backdrop: "city-terrace", outfit: "white-shirt" }, { backdrop: "glass-office", outfit: "navy-suit" }].slice(0, process.env.EMAIL ? 4 : 2) }) });
const frames = g.shoot.shots.length;

// Every 250 ms, poll through every server at once, several times each.
let s;
for (let i = 0; i < 400; i++) {
  const polls = SERVERS.flatMap((base) => Array.from({ length: Number(process.env.POLLS || 6) }, () => f(`/api/shoots/${shoot.id}`, {}, base)));
  s = (await Promise.all(polls)).map((r) => r.shoot).find(Boolean);
  if (!["generating", "reviewing"].includes(s.status)) break;
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 1500)); // let any stray background work land in the log
const log = mockLog().slice(before).split("\n");
const renders = log.filter((l) => /generateContent/.test(l) && /refs=[2-9]/.test(l)).length;
const reviews = log.filter((l) => /POST \/v1\/messages/.test(l) && /images=(\d+)/.exec(l) && Number(/images=(\d+)/.exec(l)[1]) > 3 + 1).length;
const done = s.shots.filter((x) => x.status === "done").length;
// Most frame renders running at the same moment (the pipeline's limit is 2;
// a finished frame's square widening is a separate, single-image call).
const maxInflight = Math.max(0, ...log.filter((l) => /generateContent/.test(l) && /refs=[2-9]/.test(l)).map((l) => Number(/renders=(\d+)/.exec(l)?.[1] || 0)));
const maxImageCalls = Math.max(0, ...log.filter((l) => /generateContent/.test(l)).map((l) => Number(/inflight=(\d+)/.exec(l)?.[1] || 0)));
console.log(JSON.stringify({ status: s.status, frames, done, renderCalls: renders, reviewCalls: reviews, reviewed: !!s.review, maxInflight, maxImageCalls }));
// Exit status for CI: each frame rendered once, graded once, and (with
// MOCKLOG) never more than 2 renders at the same moment.
const passed = s.status === "done" && done === frames && (!MOCKLOG || (renders === frames && reviews === 1 && maxInflight <= 2));
process.exit(passed ? 0 : 1);
