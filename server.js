import "./lib/env.js";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { users, shoots, id, readMedia, isEmpty } from "./lib/store.js";
import { hashPassword, verifyPassword, setSession, clearSession, currentUser, requireUser, publicUser } from "./lib/auth.js";
import { aiStatus, AIError } from "./lib/ai.js";
import { ingestSelfie, runCheck, runGeneration, runReview, planShots, recoverInterrupted } from "./lib/pipeline.js";
import { lookFor, MAX_LOOKS, MAX_SELFIES, MIN_SELFIES } from "./public/js/shared/catalog.js";
import { seed } from "./scripts/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(cookieParser());
app.use(express.json({ limit: "60mb" }));

if (isEmpty()) await seed();
recoverInterrupted(shoots.all());

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/* ------------------------------- Auth ------------------------------- */

app.post("/api/auth/signup", (req, res) => {
  const { name, email, password } = req.body || {};
  const errors = {};
  if (!name || String(name).trim().length < 2) errors.name = "Tell us what to call you.";
  if (!isEmail(email)) errors.email = "Enter a valid email address.";
  if (!password || String(password).length < 8) errors.password = "Use at least 8 characters.";
  if (!errors.email && users.byEmail(email)) errors.email = "An account with this email already exists. Sign in instead?";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  const user = users.create({
    id: id("usr"),
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    password: hashPassword(String(password)),
    createdAt: new Date().toISOString(),
  });
  setSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/signin", (req, res) => {
  const { email, password } = req.body || {};
  const user = isEmail(email) ? users.byEmail(email) : null;
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

app.get("/api/me", (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null, ai: aiStatus() });
});

/* ------------------------------ Shoots ------------------------------ */

const ownShoot = (req, res) => {
  const shoot = shoots.byId(req.params.id);
  if (!shoot || shoot.userId !== req.user.id) {
    res.status(404).json({ error: "We couldn't find that shoot." });
    return null;
  }
  return shoot;
};

const summary = (s) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  sample: !!s.sample,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  selfieCount: s.selfies.length,
  shotCount: s.shots.length,
  doneCount: s.shots.filter((x) => x.status === "done").length,
  cover: s.review?.bestShotId ? s.shots.find((x) => x.id === s.review.bestShotId)?.file : s.shots.find((x) => x.file)?.file || s.selfies[0]?.file,
  checkScore: s.check?.overall_score ?? null,
  bestScore: s.review?.bestShotId ? s.review.shots[s.review.bestShotId]?.overall ?? null : null,
});

app.get("/api/shoots", requireUser, (req, res) => {
  res.json({ shoots: shoots.forUser(req.user.id).map(summary) });
});

app.get("/api/shoots/:id", requireUser, (req, res) => {
  const shoot = ownShoot(req, res);
  if (shoot) res.json({ shoot });
});

app.post(
  "/api/shoots",
  requireUser,
  wrap(async (req, res) => {
    const { photos, name } = req.body || {};
    if (!Array.isArray(photos) || photos.length < MIN_SELFIES) return res.status(400).json({ error: "Add at least one photo of yourself." });
    if (photos.length > MAX_SELFIES) return res.status(400).json({ error: `Up to ${MAX_SELFIES} photos per shoot.` });
    const selfies = [];
    for (const p of photos) {
      const m = /^data:(image\/(?:jpeg|png|webp|heic|heif));base64,(.+)$/.exec(p || "");
      if (!m) return res.status(400).json({ error: "Photos must be JPG, PNG or WebP." });
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 15 * 1024 * 1024) return res.status(400).json({ error: "Each photo must be under 15 MB." });
      selfies.push(await ingestSelfie(buf));
    }
    const count = shoots.forUser(req.user.id).length + 1;
    const shoot = shoots.create({
      id: id("sht"),
      userId: req.user.id,
      name: (name && String(name).slice(0, 60)) || `Shoot No. ${String(count).padStart(2, "0")}`,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      selfies,
      check: null,
      looks: [],
      shots: [],
      review: null,
      error: null,
    });
    res.status(201).json({ shoot });
  }),
);

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

app.post(
  "/api/shoots/:id/check",
  requireUser,
  wrap(async (req, res) => {
    const shoot = ownShoot(req, res);
    if (!shoot || !requireAI("vision", res)) return;
    if (shoot.sample) return res.status(400).json({ error: "Sample shoots are read-only. Start a new shoot to use your own photos." });
    const updated = await runCheck(shoot.id);
    res.json({ shoot: updated });
  }),
);

app.post("/api/shoots/:id/generate", requireUser, (req, res) => {
  const shoot = ownShoot(req, res);
  if (!shoot || !requireAI("imaging", res) || !requireAI("vision", res)) return;
  if (shoot.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
  if (!shoot.check) return res.status(400).json({ error: "Run the photo check first." });
  if (shoot.check.verdict === "retake" && !req.body?.override) return res.status(400).json({ error: "These photos need a retake before we can shoot. Add better photos and re-check." });
  if (["generating", "reviewing"].includes(shoot.status)) return res.status(409).json({ error: "This shoot is already in progress." });
  const looks = (req.body?.looks || []).map((l) => lookFor(l.backdrop, l.outfit)).filter(Boolean);
  const unique = [...new Map(looks.map((l) => [l.id, l])).values()];
  if (!unique.length) return res.status(400).json({ error: "Pick at least one look." });
  if (unique.length > MAX_LOOKS) return res.status(400).json({ error: `Pick up to ${MAX_LOOKS} looks.` });
  const updated = shoots.update(shoot.id, (s) => {
    s.looks = unique.map((l) => ({ backdrop: l.backdrop.id, outfit: l.outfit.id }));
    s.shots = planShots(s.looks);
    s.review = null;
    s.reviewError = null;
    s.status = "generating";
  });
  runGeneration(shoot.id);
  res.status(202).json({ shoot: updated });
});

app.post("/api/shoots/:id/resume", requireUser, (req, res) => {
  const shoot = ownShoot(req, res);
  if (!shoot || !requireAI("imaging", res)) return;
  if (!shoot.shots.some((s) => s.status === "error")) return res.status(400).json({ error: "Nothing to resume." });
  runGeneration(shoot.id, { onlyFailed: true });
  res.status(202).json({ shoot: shoots.byId(shoot.id) });
});

app.post(
  "/api/shoots/:id/review",
  requireUser,
  wrap(async (req, res) => {
    const shoot = ownShoot(req, res);
    if (!shoot || !requireAI("vision", res)) return;
    if (!shoot.shots.some((s) => s.status === "done")) return res.status(400).json({ error: "There are no finished headshots to grade yet." });
    if (["generating", "reviewing"].includes(shoot.status)) return res.status(409).json({ error: "This shoot is still in progress." });
    runReview(shoot.id);
    res.status(202).json({ shoot: shoots.byId(shoot.id) });
  }),
);

app.patch("/api/shoots/:id", requireUser, (req, res) => {
  const shoot = ownShoot(req, res);
  if (!shoot) return;
  const name = String(req.body?.name || "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Give the shoot a name." });
  res.json({ shoot: shoots.update(shoot.id, (s) => (s.name = name)) });
});

app.delete("/api/shoots/:id", requireUser, (req, res) => {
  const shoot = ownShoot(req, res);
  if (!shoot) return;
  if (["generating", "reviewing", "checking"].includes(shoot.status)) return res.status(409).json({ error: "Wait for the shoot to finish before deleting it." });
  shoots.remove(shoot.id);
  res.json({ ok: true });
});

/* ------------------------------- Media ------------------------------ */

app.get("/media/:name", requireUser, (req, res) => {
  const name = path.basename(req.params.name);
  const owns = shoots
    .forUser(req.user.id)
    .some((s) => s.selfies.some((x) => x.file === name) || s.shots.some((x) => x.file === name));
  if (!owns) return res.status(404).end();
  const type = name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".png") ? "image/png" : "image/jpeg";
  res.set("Cache-Control", "private, max-age=31536000, immutable").type(type);
  if (req.query.download) res.attachment(`headshot-${name.replace(/\.\w+$/, "")}.${type.split("/")[1].replace("svg+xml", "svg").replace("jpeg", "jpg")}`);
  res.send(readMedia(name));
});

/* ------------------------------- Static ----------------------------- */

// Icons: serve the handful of Lucide icons the UI uses as one JS module.
const ICONS = [
  "arrow-right", "arrow-left", "arrow-up-right", "camera", "check", "check-circle-2", "circle-alert", "x", "upload", "image-plus",
  "sparkles", "shield-check", "clock-3", "download", "star", "trash-2", "log-out", "plus", "refresh-cw", "sun", "focus", "scan-face",
  "smile", "badge-check", "users", "building-2", "lock", "zap", "chevron-down", "menu", "loader", "eye", "eye-off", "wand-sparkles",
  "crown", "aperture", "info", "linkedin", "briefcase", "rotate-ccw", "mail", "pencil", "play", "layers", "user-round",
];
const iconModule = (() => {
  const dir = path.join(__dirname, "node_modules/lucide-static/icons");
  const map = {};
  for (const n of ICONS) {
    const f = path.join(dir, `${n}.svg`);
    if (!fs.existsSync(f)) continue;
    const svg = fs.readFileSync(f, "utf8");
    map[n] = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>")).replace(/\s+/g, " ").trim();
  }
  return `export const ICONS = ${JSON.stringify(map)};`;
})();
app.get("/js/icons.js", (req, res) => res.type("application/javascript").send(iconModule));

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
// SPA fallback for client routes.
app.get(/^\/(?!api|media).*/, (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

app.use((err, req, res, next) => {
  const status = err instanceof AIError ? err.status : err.type === "entity.too.large" ? 413 : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 413 ? "Those photos are too large together. Try fewer or smaller photos." : err.message || "Something went wrong." });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  const s = aiStatus();
  console.log(`AI Headshot Guru running at http://localhost:${port}`);
  console.log(`  Claude (${s.visionModel}): ${s.vision ? "ready" : "missing ANTHROPIC_API_KEY"}`);
  console.log(`  Gemini (${s.imageModel}): ${s.imaging ? "ready" : "missing GEMINI_API_KEY"}`);
});
