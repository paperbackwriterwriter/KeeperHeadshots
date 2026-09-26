// DEV/QA ONLY — drives the HTTP API through a whole shoot. Run against a server
// wired to scripts/dev/mock-ai.js (or real keys, which costs real money).
import sharp from "sharp";
import { portraitSVG } from "../../public/js/shared/portrait.js";

const B = process.env.BASE || "http://localhost:3100";
let cookie = "";
const f = async (p, o = {}) => {
  const r = await fetch(B + p, { ...o, headers: { "content-type": "application/json", cookie } });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const j = await r.json();
  if (!r.ok) console.log("ERR", p, r.status, j);
  return j;
};
await f("/api/auth/signup", { method: "POST", body: JSON.stringify({ name: "Test User", email: `t${Date.now()}@x.com`, password: "password123" }) });
const photos = [];
for (let i = 0; i < 3; i++) {
  const b = await sharp(Buffer.from(portraitSVG("sf" + i, { outfit: "white-shirt" }))).resize(900, 1125).jpeg().toBuffer();
  photos.push("data:image/jpeg;base64," + b.toString("base64"));
}
const { shoot } = await f("/api/shoots", { method: "POST", body: JSON.stringify({ photos }) });
console.log("created", shoot.id, shoot.status);
const c = await f(`/api/shoots/${shoot.id}/check`, { method: "POST" });
console.log("check", c.shoot.status, c.shoot.check.overall_score, c.shoot.check.photos.length);
const g = await f(`/api/shoots/${shoot.id}/generate`, { method: "POST", body: JSON.stringify({ looks: [{ backdrop: "studio-gray", outfit: "navy-suit" }, { backdrop: "library", outfit: "camel-knit" }] }) });
console.log("gen", g.shoot.status, g.shoot.shots.length);
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const s = (await f(`/api/shoots/${shoot.id}`)).shoot;
  console.log(s.status, s.shots.map((x) => x.status[0]).join(""));
  if (!["generating", "reviewing"].includes(s.status)) {
    console.log(JSON.stringify({ review: s.review && { h: s.review.headline, best: s.review.bestShotId, n: Object.keys(s.review.shots).length }, err: s.error, rerr: s.reviewError }));
    break;
  }
}
