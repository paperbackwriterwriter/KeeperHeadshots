import "./lib/env.js";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { users, shoots, id, readMedia } from "./lib/store.js";
import { backend } from "./lib/storage.js";
import { hashPassword, verifyPassword, setSession, clearSession, currentUser, requireUser, publicUser } from "./lib/auth.js";
import { aiStatus, AIError } from "./lib/ai.js";
import { ingestSelfie, runCheck, advance, startGeneration, retryFailed, startReview } from "./lib/pipeline.js";
import { lookFor, MAX_LOOKS, MAX_SELFIES } from "./public/js/shared/catalog.js";
import { seed, DEMO } from "./scripts/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");

const app = express();
app.disable("x-powered-by");
app.use(cookieParser());
// Photos are uploaded one per request, which keeps every body well under
// Vercel's 4.5 MB request limit.
app.use(express.json({ limit: "4mb" }));

const isEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const LIVE = ["checking", "generating", "reviewing"];

/* ------------------------------- Auth ------------------------------- */

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  const errors = {};
  if (!name || String(name).trim().length < 2) errors.name = "Tell us what to call you.";
  if (!isEmail(email)) errors.email = "Enter a valid email address.";
  if (!password || String(password).length < 8) errors.password = "Use at least 8 characters.";
  if (!errors.email && (await users.byEmail(email))) errors.email = "An account with this email already exists. Sign in instead?";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  const user = await users.create({
    id: id("usr"),
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    password: hashPassword(String(password)),
    createdAt: new Date().toISOString(),
  });
  setSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/signin", async (req, res) => {
  const { email, password } = req.body || {};
  if (isEmail(email) && email.toLowerCase().trim() === DEMO.email) await seed();
  const user = isEmail(email) ? await users.byEmail(email) : null;
  if (!user || !password || !verifyPassword(String(password), user.password)) {
    return res.status(401).json({ error: "That email and password don't match an account." });
  }
  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/signout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const user = await currentUser(req);
  res.json({ user: user ? publicUser(user) : null, ai: aiStatus() });
});

/* ------------------------------ Shoots ------------------------------ */

async function ownShoot(req, res, { full = true } = {}) {
  const shoot = full ? await shoots.get(req.params.id) : await shoots.getMeta(req.params.id);
  if (!shoot || shoot.userId !== req.user.id) {
    res.status(404).json({ error: "We couldn't find that shoot." });
    return null;
  }
  return shoot;
}

const summary = (s) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  sample: !!s.sample,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  selfieCount: s.selfies.length,
  shotCount: (s.shots || []).length,
  doneCount: s.doneCount || 0,
  cover: s.cover || s.selfies[0]?.file || null,
  checkScore: s.check?.overall_score ?? null,
  bestScore: s.bestScore ?? null,
});

app.get("/api/shoots", requireUser, async (req, res) => {
  res.json({ shoots: (await shoots.forUser(req.user.id)).map(summary) });
});

// Polled by the studio while a shoot is live; each poll also moves it forward.
app.get("/api/shoots/:id", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot) return;
  res.json({ shoot: LIVE.includes(shoot.status) ? await advance(shoot.id) : shoot });
});

app.post("/api/shoots", requireUser, async (req, res) => {
  const count = (await shoots.forUser(req.user.id)).length + 1;
  const now = new Date().toISOString();
  const shoot = await shoots.create({
    id: id("sht"),
    userId: req.user.id,
    name: (req.body?.name && String(req.body.name).slice(0, 60)) || `Shoot No. ${String(count).padStart(2, "0")}`,
    status: "draft",
    createdAt: now,
    selfies: [],
    check: null,
    looks: [],
    shots: [],
    review: null,
    error: null,
  });
  res.status(201).json({ shoot });
});

app.post("/api/shoots/:id/selfies", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta) return;
  if (meta.sample || meta.status !== "draft" || meta.check) return res.status(400).json({ error: "Photos can only be added to a new shoot." });
  if (meta.selfies.length >= MAX_SELFIES) return res.status(400).json({ error: `Up to ${MAX_SELFIES} photos per shoot.` });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(req.body?.photo || "");
  if (!m) return res.status(400).json({ error: "Photos must be JPG, PNG or WebP." });
  const selfie = await ingestSelfie(meta.id, Buffer.from(m[2], "base64"));
  // Re-read before writing so sequential uploads never drop each other.
  const fresh = await shoots.getMeta(meta.id);
  fresh.selfies.push(selfie);
  await shoots.saveMeta(fresh);
  res.status(201).json({ selfie, count: fresh.selfies.length });
});

function requireAI(kind, res) {
  const s = aiStatus();
  if (kind === "vision" && !s.vision) {
    res.status(503).json({ error: "The AI photo reviewer isn't configured. Add ANTHROPIC_API_KEY to the server environment.", code: "ai_not_configured" });
    return false;
  }
  if (kind === "imaging" && !s.imaging) {
    res.status(503).json({ error: "The AI image studio isn't configured. Add GEMINI_API_KEY to the server environment.", code: "ai_not_configured" });
    return false;
  }
  return true;
}

app.post("/api/shoots/:id/check", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta || !requireAI("vision", res)) return;
  if (meta.sample) return res.status(400).json({ error: "Sample shoots are read-only. Start a new shoot to use your own photos." });
  if (!meta.selfies.length) return res.status(400).json({ error: "Add at least one photo first." });
  await runCheck(meta.id);
  res.json({ shoot: await shoots.get(meta.id) });
});

app.post("/api/shoots/:id/generate", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta || !requireAI("imaging", res) || !requireAI("vision", res)) return;
  if (meta.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
  if (!meta.check) return res.status(400).json({ error: "Run the photo check first." });
  if (meta.check.verdict === "retake" && !req.body?.override) return res.status(400).json({ error: "These photos need a retake before we can shoot. Add better photos and re-check." });
  if (LIVE.includes(meta.status)) return res.status(409).json({ error: "This shoot is already in progress." });
  const looks = (req.body?.looks || []).map((l) => lookFor(l.backdrop, l.outfit)).filter(Boolean);
  const unique = [...new Map(looks.map((l) => [l.id, l])).values()];
  if (!unique.length) return res.status(400).json({ error: "Pick at least one look." });
  if (unique.length > MAX_LOOKS) return res.status(400).json({ error: `Pick up to ${MAX_LOOKS} looks.` });
  res.status(202).json({ shoot: await startGeneration(meta, unique) });
});

app.post("/api/shoots/:id/resume", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot || !requireAI("imaging", res)) return;
  if (!shoot.shots.some((s) => s.status === "error")) return res.status(400).json({ error: "Nothing to resume." });
  res.status(202).json({ shoot: await retryFailed(shoot.id) });
});

app.post("/api/shoots/:id/review", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot || !requireAI("vision", res)) return;
  if (!shoot.shots.some((s) => s.status === "done")) return res.status(400).json({ error: "There are no finished headshots to grade yet." });
  if (LIVE.includes(shoot.status)) return res.status(409).json({ error: "This shoot is still in progress." });
  res.status(202).json({ shoot: await startReview(shoot.id) });
});

// Rename a shoot, or set/clear the person's own best pick.
app.patch("/api/shoots/:id", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot) return;
  const meta = await shoots.getMeta(shoot.id);
  if ("name" in (req.body || {})) {
    const name = String(req.body.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: "Give the shoot a name." });
    meta.name = name;
  }
  if ("pickedShotId" in (req.body || {})) {
    const pickId = req.body.pickedShotId;
    const pick = pickId ? shoot.shots.find((s) => s.id === pickId && s.status === "done") : null;
    if (pickId && !pick) return res.status(400).json({ error: "That headshot isn't available to pick." });
    meta.pickedShotId = pick ? pick.id : null;
    const featured = pick || shoot.shots.find((s) => s.id === meta.review?.bestShotId);
    if (featured) {
      meta.cover = featured.file;
      meta.bestScore = meta.review?.shots?.[featured.id]?.overall ?? null;
    }
  }
  await shoots.saveMeta(meta);
  res.json({ shoot: await shoots.get(meta.id) });
});

app.delete("/api/shoots/:id", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta) return;
  if (LIVE.includes(meta.status)) return res.status(409).json({ error: "Wait for the shoot to finish before deleting it." });
  await shoots.remove(meta);
  res.json({ ok: true });
});

/* ------------------------------- Media ------------------------------ */

app.get("/media/:sid/:name", requireUser, async (req, res) => {
  const { sid, name } = req.params;
  if (!/^[\w-]+$/.test(sid) || !/^[\w-]+\.(jpg|png|svg)$/.test(name)) return res.status(404).end();
  const meta = await shoots.getMeta(sid);
  if (!meta || meta.userId !== req.user.id) return res.status(404).end();
  const buf = await readMedia(`${sid}/${name}`);
  if (!buf) return res.status(404).end();
  const type = name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".png") ? "image/png" : "image/jpeg";
  res.set("Cache-Control", "private, max-age=31536000, immutable").type(type);
  if (req.query.download) res.attachment(`headshot-${name.replace(/\.\w+$/, "")}.${name.split(".").pop()}`);
  res.send(buf);
});

/* ------------------------------- Static ----------------------------- */

// On Vercel, files in public/ are served by the CDN before reaching Express.
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use("/media", (req, res) => res.status(404).end());
// SPA fallback for client routes.
app.get(/.*/, (req, res) => res.type("html").send(INDEX_HTML));

app.use((err, req, res, next) => {
  const status = err instanceof AIError ? err.status : err.type === "entity.too.large" ? 413 : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? "That photo is too large. Try a smaller one." : status === 500 && !(err instanceof AIError) ? "Something went wrong on our side. Please try again." : err.message });
});

export default app;

if (!process.env.VERCEL) {
  await seed();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    const s = aiStatus();
    console.log(`AI Headshot Guru running at http://localhost:${port} (storage: ${backend})`);
    console.log(`  Claude (${s.visionModel}): ${s.vision ? "ready" : "missing ANTHROPIC_API_KEY"}`);
    console.log(`  Gemini (${s.imageModel}): ${s.imaging ? "ready" : "missing GEMINI_API_KEY"}`);
  });
}
