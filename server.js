import "./lib/env.js";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { users, shoots, id, readMedia, deleteMedia } from "./lib/store.js";
import { backend } from "./lib/storage.js";
import { hashPassword, verifyPassword, setSession, clearSession, currentUser, requireUser, publicUser } from "./lib/auth.js";
import { aiStatus, AIError } from "./lib/ai.js";
import { ingestSelfie, runCheck, advance, startGeneration, retryFailed, startReview } from "./lib/pipeline.js";
import { lookFor, MAX_LOOKS, MAX_SELFIES } from "./public/js/shared/catalog.js";
import { seed, DEMO } from "./scripts/seed.js";
import { planFor, PlanError, FREE, DEMO_READ_ONLY, NO_SHOOTS_LEFT } from "./lib/plan.js";
import { contactEnabled, validate as validateContact, rateLimited, submit as submitContact } from "./lib/contact.js";
import { JOBS as EXAMPLE_JOBS, status as exampleStatus, generate as generateExample, generateSet as generateExampleSet, exampleImage, sheet as exampleSheet } from "./lib/examples.js";
import crypto from "node:crypto";
import { billingEnabled, createCheckout, confirm as confirmCheckout, sync as syncPurchases, handleWebhook } from "./lib/billing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(cookieParser());

// Stripe webhook needs the raw body for signature checks, so it's registered
// before the JSON parser. Optional: purchases are also confirmed on return.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !billingEnabled()) return res.status(404).end();
  try {
    await handleWebhook(req.body, req.headers["stripe-signature"]);
    res.json({ received: true });
  } catch (err) {
    console.error("[webhook]", err.message);
    res.status(400).json({ error: "Invalid webhook" });
  }
});
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
  const { vision, imaging } = aiStatus();
  res.json({ user: user ? publicUser(user) : null, ai: { vision, imaging } });
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
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  if (!plan.canDevelop) throw new PlanError(NO_SHOOTS_LEFT);
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

// Photos can be added or removed until developing starts, so a person can
// top up their set after the photo check without losing what they uploaded.
const canEditPhotos = (meta) => !meta.sample && ["draft", "checked", "error"].includes(meta.status) && !(meta.shots || []).length;

app.post("/api/shoots/:id/selfies", requireUser, async (req, res) => {
  if (req.user.demo) throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  const meta = await ownShoot(req, res, { full: false });
  if (!meta) return;
  if (!canEditPhotos(meta)) return res.status(400).json({ error: "Photos can't be changed once developing has started. Start a new shoot instead." });
  if (meta.selfies.length >= MAX_SELFIES) return res.status(400).json({ error: `Up to ${MAX_SELFIES} photos per shoot. Remove one to make room.` });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(req.body?.photo || "");
  if (!m) return res.status(400).json({ error: "Photos must be JPG, PNG or WebP." });
  const selfie = await ingestSelfie(meta.id, Buffer.from(m[2], "base64"));
  // Re-read before writing so sequential uploads never drop each other.
  const fresh = await shoots.getMeta(meta.id);
  fresh.selfies.push(selfie);
  // The set changed, so the old check no longer describes it.
  Object.assign(fresh, { check: null, status: "draft", error: null });
  await shoots.saveMeta(fresh);
  res.status(201).json({ selfie, count: fresh.selfies.length });
});

app.delete("/api/shoots/:id/selfies/:name", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta) return;
  if (!canEditPhotos(meta)) return res.status(400).json({ error: "Photos can't be changed once developing has started." });
  const index = meta.selfies.findIndex((s) => s.file === `${meta.id}/${req.params.name}`);
  if (index < 0) return res.status(404).json({ error: "That photo isn't in this shoot." });
  if (meta.selfies.length <= 1) return res.status(400).json({ error: "A shoot needs at least one photo." });
  const [removed] = meta.selfies.splice(index, 1);
  // Keep the rest of the photo check, re-pointed at the remaining photos.
  if (meta.check?.photos) {
    meta.check.photos = meta.check.photos.filter((p) => p.index !== index).map((p) => (p.index > index ? { ...p, index: p.index - 1 } : p));
  }
  await shoots.saveMeta(meta);
  await deleteMedia(removed.file).catch(() => {});
  res.json({ shoot: await shoots.get(meta.id) });
});

function requireAI(kind, res) {
  const s = aiStatus();
  if (kind === "vision" && !s.vision) {
    res.status(503).json({ error: "The AI studio is temporarily unavailable. Please try again later.", code: "ai_not_configured" });
    return false;
  }
  if (kind === "imaging" && !s.imaging) {
    res.status(503).json({ error: "The AI studio is temporarily unavailable. Please try again later.", code: "ai_not_configured" });
    return false;
  }
  return true;
}

app.post("/api/shoots/:id/check", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta || !requireAI("vision", res)) return;
  if (meta.sample) return res.status(400).json({ error: "Sample shoots are read-only. Start a new shoot to use your own photos." });
  if (!meta.selfies.length) return res.status(400).json({ error: "Add at least one photo first." });
  if (!canEditPhotos(meta)) return res.status(409).json({ error: "This shoot has already been developed. Start a new shoot to check new photos." });
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  if (plan.checksLeft === 0) throw new PlanError(`Free accounts include ${FREE.checks} photo checks, and you've used them. Buy a package to keep going.`);
  await runCheck(meta.id);
  // Only a completed check counts toward the free allowance.
  if (plan.checksLeft != null) await users.update(req.user.id, (u) => (u.usage = { ...u.usage, checks: (u.usage?.checks || 0) + 1 }));
  res.json({ shoot: await shoots.get(meta.id) });
});

app.post("/api/shoots/:id/generate", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta || !requireAI("imaging", res) || !requireAI("vision", res)) return;
  if (meta.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
  if (!meta.check) return res.status(400).json({ error: "Run the photo check first." });
  if (meta.check.verdict === "retake" && !req.body?.override) return res.status(400).json({ error: "These photos need a retake before we can shoot. Add better photos and re-check." });
  if (LIVE.includes(meta.status)) return res.status(409).json({ error: "This shoot is already in progress." });
  // A shoot is developed once; retries of failed frames go through /resume.
  if (meta.status !== "checked" || (meta.shots || []).length) return res.status(409).json({ error: "This shoot has already been developed. Start a new shoot for new looks." });
  const looks = (req.body?.looks || []).map((l) => lookFor(l.backdrop, l.outfit)).filter(Boolean);
  const unique = [...new Map(looks.map((l) => [l.id, l])).values()];
  if (!unique.length) return res.status(400).json({ error: "Pick at least one look." });
  if (unique.length > MAX_LOOKS) return res.status(400).json({ error: `Pick up to ${MAX_LOOKS} looks.` });
  // Pay for the shoot: owner free; the free trial covers up to FREE.looks
  // looks; otherwise it uses one credit.
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  if (plan.tier !== "owner") {
    if (plan.freeShootAvailable && unique.length <= FREE.looks) {
      await users.update(req.user.id, (u) => (u.usage = { ...u.usage, freeShootUsed: meta.id }));
      meta.paidWith = "free";
    } else if (plan.credits > 0) {
      await users.update(req.user.id, (u) => (u.credits = Math.max(0, (u.credits || 0) - 1)));
      meta.paidWith = "credit";
    } else if (plan.freeShootAvailable) {
      throw new PlanError(`Your free shoot includes up to ${FREE.looks} looks. Remove ${unique.length - FREE.looks} to continue.`, "too_many_looks", 400);
    } else {
      throw new PlanError(NO_SHOOTS_LEFT);
    }
  }
  res.status(202).json({ shoot: await startGeneration(meta, unique) });
});

app.post("/api/shoots/:id/resume", requireUser, async (req, res) => {
  if (req.user.demo) throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
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
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  if (plan.tier !== "owner" && (shoot.regrades || 0) >= FREE.regradesPerShoot) throw new PlanError(`You can re-grade a shoot up to ${FREE.regradesPerShoot} times.`, "regrade_limit", 429);
  const meta = await shoots.getMeta(shoot.id);
  meta.regrades = (meta.regrades || 0) + 1;
  await shoots.saveMeta(meta);
  res.status(202).json({ shoot: await startReview(shoot.id) });
});

// Rename a shoot, or set/clear the person's own best pick.
app.patch("/api/shoots/:id", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot) return;
  if (shoot.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
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
  if (meta.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
  if (LIVE.includes(meta.status)) return res.status(409).json({ error: "Wait for the shoot to finish before deleting it." });
  await shoots.remove(meta);
  res.json({ ok: true });
});

/* ------------------------------ Billing ----------------------------- */

function requireBilling(req, res) {
  if (!billingEnabled()) {
    res.status(503).json({ error: "Payments aren't set up yet. Please check back soon.", code: "billing_not_configured" });
    return false;
  }
  if (req.user.demo) {
    res.status(403).json({ error: DEMO_READ_ONLY, code: "demo_read_only" });
    return false;
  }
  return true;
}

app.post("/api/billing/checkout", requireUser, async (req, res) => {
  if (!requireBilling(req, res)) return;
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({ url: await createCheckout(req.user, String(req.body?.packageId || ""), origin) });
});

app.post("/api/billing/confirm", requireUser, async (req, res) => {
  if (!requireBilling(req, res)) return;
  const result = await confirmCheckout(req.user, req.body?.sessionId);
  res.json({ ...result, user: publicUser(await users.byId(req.user.id)) });
});

app.post("/api/billing/sync", requireUser, async (req, res) => {
  if (!billingEnabled() || req.user.demo) return res.json({ added: 0, user: publicUser(req.user) });
  const added = await syncPurchases(req.user);
  res.json({ added, user: publicUser(added ? await users.byId(req.user.id) : req.user) });
});

/* ------------------------------ Contact ----------------------------- */

app.post("/api/contact", async (req, res) => {
  // Honeypot: people never see or fill this field; bots usually do.
  if (req.body?.company) return res.json({ ok: true });
  const { msg, fields } = validateContact(req.body);
  if (Object.keys(fields).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields });
  if (rateLimited(req.ip || "unknown")) return res.status(429).json({ error: "You've sent several messages already. Please try again later." });
  if (!contactEnabled()) return res.status(503).json({ error: "Our contact form is offline right now.", code: "contact_not_configured" });
  try {
    await submitContact(msg, { user: await currentUser(req).catch(() => null), ip: req.ip });
  } catch (err) {
    console.error("[contact]", err.message);
    return res.status(502).json({ error: "We couldn't send your message just now." });
  }
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

/* ----------------------------- Examples ----------------------------- */

// Marketing example headshots (see lib/examples.js).
app.get("/examples/:id.jpg", async (req, res) => {
  const buf = /^[a-z0-9-]+$/.test(req.params.id) ? await exampleImage(req.params.id) : null;
  if (!buf) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400").type("image/jpeg").send(buf);
});

// Owner-only generator, enabled only while ADMIN_TOKEN is set.
function adminOnly(req, res, next) {
  const want = process.env.ADMIN_TOKEN || "";
  const got = String(req.query.token || req.get("x-admin-token") || "");
  const ok = want.length >= 24 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) return res.status(404).json({ error: "Not found" });
  next();
}
app.get("/api/admin/examples", adminOnly, async (req, res) => res.json({ examples: await exampleStatus() }));
app.get("/api/admin/examples-set/:set", adminOnly, async (req, res) => {
  res.status(202).json({ started: generateExampleSet(req.params.set, { force: req.query.force === "1" }) });
});
app.get("/api/admin/examples-sheet", adminOnly, async (req, res) => {
  const ids = String(req.query.ids || Object.keys(EXAMPLE_JOBS).join(",")).split(",");
  const jpg = await exampleSheet(ids, Math.min(600, Number(req.query.w) || 240), Math.max(1, Number(req.query.cols) || 4));
  res.json({ jpeg: jpg ? jpg.toString("base64") : null });
});
app.get("/api/admin/examples/:id", adminOnly, async (req, res) => {
  if (!EXAMPLE_JOBS[req.params.id]) return res.status(404).json({ error: "Unknown example." });
  const started = Date.now();
  const bytes = await generateExample(req.params.id);
  res.json({ ok: true, id: req.params.id, bytes, ms: Date.now() - started });
});

/* ------------------------------- Static ----------------------------- */

// On Vercel, files in public/ are served by the CDN before reaching Express.
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use("/media", (req, res) => res.status(404).end());
// SPA fallback for client routes.
app.get(/.*/, (req, res) => res.type("html").send(INDEX_HTML));

app.use((err, req, res, next) => {
  if (err instanceof PlanError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.type?.startsWith?.("Stripe")) {
    console.error("[stripe]", err.type, err.message);
    return res.status(502).json({ error: "The payment provider couldn't complete that request. Please try again." });
  }
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "That photo is too large. Try a smaller one." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "That request couldn't be read. Please try again." });
  if (err?.status && err.status < 500 && !(err instanceof AIError)) return res.status(err.status).json({ error: err.message });
  const status = err instanceof AIError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 500 && !(err instanceof AIError) ? "Something went wrong on our side. Please try again." : err.message });
});

export default app;

if (!process.env.VERCEL) {
  await seed();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    const s = aiStatus();
    console.log(`Keeper Headshots running at http://localhost:${port} (storage: ${backend})`);
    console.log(`  Claude (${s.visionModel}): ${s.vision ? "ready" : "missing ANTHROPIC_API_KEY"}`);
    console.log(`  Gemini (${s.imageModel}): ${s.imaging ? "ready" : "missing GEMINI_API_KEY"}`);
  });
}
