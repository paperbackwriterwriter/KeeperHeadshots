import "./lib/env.js";
import express from "express";
import sharp from "sharp";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { users, shoots, id, readMedia, writeMedia, deleteMedia, freeClaimKey } from "./lib/store.js";
import { backend, createJSON, getJSON, del } from "./lib/storage.js";
import { hashPassword, verifyPassword, setSession, clearSession, currentUser, requireUser, publicUser, emailToken, checkEmailToken, emailVerified, resetToken, checkResetToken } from "./lib/auth.js";
import { mailEnabled, sendMail, verificationEmail, passwordResetEmail, MAIL_FROM } from "./lib/mail.js";
import { checkHuman, turnstileSiteKey } from "./lib/turnstile.js";
import { pageFor, isCanonicalHost } from "./lib/seo.js";
import { aiStatus, AIError } from "./lib/ai.js";
import { ingestSelfie, runCheck, advance, startGeneration, retryFailed, startReview } from "./lib/pipeline.js";
import { lookFor, MAX_LOOKS, MAX_SELFIES, PHOTO_FORMATS } from "./public/js/shared/catalog.js";
import { seed, DEMO } from "./scripts/seed.js";
import { planFor, PlanError, FREE, DEMO_READ_ONLY, NO_SHOOTS_LEFT, EMAIL_UNCONFIRMED } from "./lib/plan.js";
import { gpc, metaPixelId, track as trackMeta } from "./lib/meta.js";
import { contactEnabled, validate as validateContact, rateLimited, submit as submitContact } from "./lib/contact.js";
import { JOBS as EXAMPLE_JOBS, status as exampleStatus, generate as generateExample, generateSquare as generateExampleSquare, generateSet as generateExampleSet, exampleImage, sheet as exampleSheet } from "./lib/examples.js";
import crypto from "node:crypto";
import { billingEnabled, createCheckout, confirm as confirmCheckout, sync as syncPurchases, handleWebhook } from "./lib/billing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
// Links we email or hand to Stripe use a fixed origin in production, never the
// request's Host header (which a client controls).
const appOrigin = (req) => process.env.APP_ORIGIN || (process.env.VERCEL_ENV === "production" ? "https://keeperheadshots.com" : `${req.protocol}://${req.get("host")}`);

const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_FAILS = 10;
const DUMMY_HASH = hashPassword("not-a-real-password");

const LIVE = ["checking", "generating", "reviewing"];
const MAX_RESUMES = 3;

/* ------------------------------- Auth ------------------------------- */

// Email confirmation: the free shoot unlocks once the person clicks the link
// we email them, which stops throwaway sign-ups from claiming free shoots.
async function sendVerification(user, req) {
  const link = `${appOrigin(req)}/verify?token=${emailToken(user)}`;
  if (!mailEnabled()) {
    // Only print the link itself in local development; in production it's a sign-in link.
    console.warn("[verify] Email is not configured; no confirmation email sent for", user.id, process.env.VERCEL ? "" : link);
    return false;
  }
  const { subject, text, html } = verificationEmail({ name: user.name, link });
  await sendMail({ from: { name: "Keeper Headshots", address: MAIL_FROM }, to: { name: user.name, address: user.email }, subject, text, html });
  return true;
}

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  const errors = {};
  if (!name || String(name).trim().length < 2) errors.name = "Tell us what to call you.";
  else if (String(name).trim().length > 80 || /https?:|www\.|[<>\u0000-\u001f]/i.test(String(name))) errors.name = "Use just your name (up to 80 characters, no links).";
  if (!isEmail(email)) errors.email = "Enter a valid email address.";
  if (!password || String(password).length < 8) errors.password = "Use at least 8 characters.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  // Bot check first, so the "already exists" answer can't be scraped by scripts.
  const human = await checkHuman(req.body?.turnstileToken, { ip: req.ip, action: "signup" });
  if (!human.ok) return res.status(400).json({ error: "We couldn't confirm you're a person. Please complete the security check and try again.", code: "bot_check" });
  if (await users.byEmail(email)) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: { email: "An account with this email already exists. Sign in instead?" } });
  const user = await users.create({
    id: id("usr"),
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    password: hashPassword(String(password)),
    createdAt: new Date().toISOString(),
    emailVerified: false,
    verifySends: [Date.now()],
  });
  setSession(res, user);
  // Meta's CompleteRegistration fires when the email is confirmed (below).
  const verificationSent = await sendVerification(user, req).catch((err) => {
    console.error("[verify] send failed", user.id, err.message);
    return false;
  });
  res.status(201).json({ user: publicUser(user), verificationSent });
});

app.post("/api/auth/signin", async (req, res) => {
  const { email, password } = req.body || {};
  if (isEmail(email) && email.toLowerCase().trim() === DEMO.email) await seed();
  const user = isEmail(email) ? await users.byEmail(email) : null;
  // Slow down password guessing: after 10 wrong passwords in 15 minutes the
  // account refuses sign-ins for the rest of that window (stored on the user,
  // so it holds across serverless instances).
  const now = Date.now();
  const recent = (user?.signinFails || []).filter((t) => now - t < SIGNIN_WINDOW_MS);
  if (recent.length >= SIGNIN_MAX_FAILS) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again, or reset your password." });
  // Always run the (async) password hash, even for unknown emails, so timing
  // doesn't reveal which addresses have accounts.
  const ok = await verifyPassword(String(password || ""), user?.password || DUMMY_HASH);
  if (!user || !password || !ok) {
    if (user) await users.update(user.id, (u) => (u.signinFails = [...(u.signinFails || []).filter((t) => now - t < SIGNIN_WINDOW_MS), now])).catch(() => {});
    return res.status(401).json({ error: "That email and password don't match an account." });
  }
  if (recent.length) await users.update(user.id, (u) => (u.signinFails = [])).catch(() => {});
  setSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/verify", async (req, res) => {
  const { user, error } = await checkEmailToken(req.body?.token);
  if (error === "invalid") return res.status(400).json({ error: "This confirmation link isn't valid. Make sure you copied the whole link, or ask for a new one.", code: "invalid" });
  const me = await currentUser(req);
  if (emailVerified(user)) return res.json({ status: "already", user: me ? publicUser(me) : null });
  if (error === "expired") return res.status(410).json({ error: "This confirmation link has expired. Ask for a new one below.", code: "expired", signedIn: me?.id === user.id });
  const updated = await users.update(user.id, (u) => {
    u.emailVerified = true;
    u.emailVerifiedAt = new Date().toISOString();
  });
  // Opening the link on another device signs you in there too (only on the
  // first, confirming click; the link can't be reused to sign in later).
  if (me?.id !== user.id) setSession(res, user);
  const eventId = `reg_${user.id}`;
  trackMeta("CompleteRegistration", { eventId, user: updated, req });
  res.json({ status: "verified", user: publicUser(updated), eventId });
});

app.post("/api/auth/verify/resend", requireUser, async (req, res) => {
  if (emailVerified(req.user)) return res.json({ status: "already", user: publicUser(req.user) });
  const now = Date.now();
  const sends = (req.user.verifySends || []).filter((t) => now - t < 24 * 60 * 60 * 1000);
  if (sends.length && now - sends[sends.length - 1] < 60 * 1000) return res.status(429).json({ error: "We just sent one. Give it a minute, and check your spam folder too." });
  if (sends.length >= 5) return res.status(429).json({ error: "We've sent several emails today. Check your spam folder, or contact us and we'll help." });
  try {
    if (!(await sendVerification(req.user, req))) return res.status(503).json({ error: "Email isn't set up on this site yet. Please contact us." });
  } catch (err) {
    console.error("[verify] resend failed", req.user.id, err.message);
    return res.status(502).json({ error: "We couldn't send the email just now. Please try again in a few minutes." });
  }
  await users.update(req.user.id, (u) => (u.verifySends = [...sends, now]));
  res.json({ status: "sent", email: req.user.email });
});

app.post("/api/auth/signout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// Password reset. Step 1 emails a one-hour, single-use link (lib/auth.js
// resetToken). The answer is the same whether or not the address has an
// account, and each account gets at most 3 emails an hour, a minute apart.
const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_MAX_SENDS = 3;

app.post("/api/auth/password/forgot", async (req, res) => {
  const email = req.body?.email;
  if (!isEmail(email)) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: { email: "Enter a valid email address." } });
  const human = await checkHuman(req.body?.turnstileToken, { ip: req.ip, action: "reset" });
  if (!human.ok) return res.status(400).json({ error: "We couldn't confirm you're a person. Please complete the security check and try again.", code: "bot_check" });
  if (!mailEnabled()) return res.status(503).json({ error: "Email isn't set up on this site yet. Please contact us to reset your password." });
  const sent = () => res.json({ status: "sent" });
  const user = await users.byEmail(email);
  if (!user || user.demo) return sent();
  // Record the send atomically first, so parallel requests can't get past the limit.
  const now = Date.now();
  let allowed = false;
  await users.update(user.id, (u) => {
    const sends = (u.resetSends || []).filter((t) => now - t < RESET_WINDOW_MS);
    allowed = sends.length < RESET_MAX_SENDS && !(sends.length && now - sends[sends.length - 1] < 60 * 1000);
    if (allowed) u.resetSends = [...sends, now];
  });
  if (!allowed) return sent();
  const link = `${appOrigin(req)}/reset?token=${resetToken(user)}`;
  try {
    const { subject, text, html } = passwordResetEmail({ name: user.name, link });
    await sendMail({ from: { name: "Keeper Headshots", address: MAIL_FROM }, to: { name: user.name, address: user.email }, subject, text, html });
  } catch (err) {
    console.error("[reset] send failed", user.id, err.message);
    return res.status(502).json({ error: "We couldn't send the email just now. Please try again in a few minutes." });
  }
  sent();
});

// Step 2 sets the new password, signs out every other device (by bumping the
// session version) and signs this browser in.
app.post("/api/auth/password/reset", async (req, res) => {
  const { token, password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: { password: "Use at least 8 characters." } });
  if (String(password).length > 200) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: { password: "Use at most 200 characters." } });
  const invalid = () => res.status(400).json({ error: "This reset link isn't valid or has already been used. Ask for a new one below.", code: "invalid" });
  const { user, error } = await checkResetToken(token);
  if (error === "expired") return res.status(410).json({ error: "This reset link has expired. Ask for a new one below.", code: "expired" });
  if (error) return invalid();
  const hash = hashPassword(String(password));
  const at = new Date().toISOString();
  let used = false;
  let newlyVerified = false;
  const updated = await users.update(user.id, (u) => {
    // Another request already used this link (the password changed since we checked).
    used = u.password !== user.password;
    if (used) return;
    u.password = hash;
    u.passwordChangedAt = at;
    u.sessionVersion = (u.sessionVersion || 0) + 1;
    u.signinFails = [];
    u.resetSends = [];
    // The link came from their inbox, so this also confirms the email address.
    newlyVerified = u.emailVerified === false;
    if (newlyVerified) {
      u.emailVerified = true;
      u.emailVerifiedAt = at;
    }
  });
  if (used) return invalid();
  if (newlyVerified) trackMeta("CompleteRegistration", { eventId: `reg_${user.id}`, user: updated, req });
  setSession(res, updated);
  res.json({ user: publicUser(updated) });
});

// Signs out every other browser and device; this one stays signed in.
app.post("/api/auth/signout-all", requireUser, async (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: "The demo account is shared, so it can't sign out other devices." });
  const updated = await users.update(req.user.id, (u) => (u.sessionVersion = (u.sessionVersion || 0) + 1));
  setSession(res, updated);
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const user = await currentUser(req);
  const { vision, imaging } = aiStatus();
  res.json({ user: user ? publicUser(user) : null, ai: { vision, imaging }, meta: { pixelId: metaPixelId() }, turnstile: { siteKey: turnstileSiteKey() } });
});

/* ------------------------------ Shoots ------------------------------ */

async function ownShoot(req, res, { full = true } = {}) {
  if (!/^sht_[\w-]{6,40}$/.test(String(req.params.id))) {
    res.status(404).json({ error: "We couldn't find that shoot." });
    return null;
  }
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
  if (!LIVE.includes(shoot.status)) return res.json({ shoot });
  // A failed step (e.g. a storage conflict) is retried by the next poll; the
  // person sees the current state, not an error.
  const moved = await advance(shoot.id).catch((err) => (console.error("[advance]", shoot.id, err.message), null));
  res.json({ shoot: moved || shoot });
});

app.post("/api/shoots", requireUser, async (req, res) => {
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  if (plan.needsEmail) throw new PlanError(EMAIL_UNCONFIRMED, "email_unconfirmed", 403);
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
  if (plan.needsEmail) throw new PlanError(EMAIL_UNCONFIRMED, "email_unconfirmed", 403);
  const limitMsg = `Free accounts include ${FREE.checks} photo checks, and you've used them. Buy a package to keep going.`;
  if (plan.checksLeft === 0) throw new PlanError(limitMsg);
  // Reserve the check before the (paid) AI call so parallel requests can't
  // exceed the free allowance; give it back if the check fails.
  const counted = plan.checksLeft != null;
  if (counted) {
    await users.update(req.user.id, (u) => {
      if (planFor(u).checksLeft === 0) throw new PlanError(limitMsg);
      u.usage = { ...u.usage, checks: (u.usage?.checks || 0) + 1 };
    });
  }
  try {
    await runCheck(meta.id);
  } catch (err) {
    if (counted) await users.update(req.user.id, (u) => (u.usage = { ...u.usage, checks: Math.max(0, (u.usage?.checks || 0) - 1) })).catch(() => {});
    throw err;
  }
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
  const looks = (Array.isArray(req.body?.looks) ? req.body.looks : []).map((l) => (l && typeof l === "object" ? lookFor(String(l.backdrop), String(l.outfit)) : null)).filter(Boolean);
  const unique = [...new Map(looks.map((l) => [l.id, l])).values()];
  if (!unique.length) return res.status(400).json({ error: "Pick at least one look." });
  if (unique.length > MAX_LOOKS) return res.status(400).json({ error: `Pick up to ${MAX_LOOKS} looks.` });
  // Pay for the shoot: owner free; the free trial covers up to FREE.looks
  // looks; otherwise it uses one credit. The shoot is claimed first (write-once)
  // so two clicks can't charge twice, and the charge is re-checked inside an
  // atomic update of the user record so two shoots can't share one credit.
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  const claimKey = `claims/develop/${meta.id}.json`;
  if (!(await createJSON(claimKey, { userId: req.user.id, at: new Date().toISOString() }))) {
    return res.status(409).json({ error: "This shoot is already in progress." });
  }
  let charged = null;
  try {
    if (plan.tier !== "owner") {
      if (plan.needsEmail && !plan.credits) throw new PlanError(EMAIL_UNCONFIRMED, "email_unconfirmed", 403);
      // One free shoot per mailbox, however the address is written.
      const wantsFree = plan.freeShootAvailable && !plan.needsEmail && unique.length <= FREE.looks;
      let freeOk = false;
      if (wantsFree) {
        const key = freeClaimKey(req.user.email);
        freeOk = (await createJSON(key, { userId: req.user.id, shootId: meta.id, at: new Date().toISOString() })) || (await getJSON(key))?.userId === req.user.id;
      }
      await users.update(req.user.id, (u) => {
        const p = planFor(u);
        if (freeOk && p.freeShootAvailable) {
          u.usage = { ...u.usage, freeShootUsed: meta.id };
          charged = "free";
        } else if (p.credits > 0) {
          u.credits = p.credits - 1;
          charged = "credit";
        } else if (wantsFree && !freeOk) {
          throw new PlanError("The free shoot has already been used for this email address. Buy a package to keep going.", "free_used");
        } else if (p.freeShootAvailable && unique.length > FREE.looks) {
          throw new PlanError(`Your free shoot includes up to ${FREE.looks} looks. Remove ${unique.length - FREE.looks} to continue.`, "too_many_looks", 400);
        } else {
          throw new PlanError(NO_SHOOTS_LEFT);
        }
      });
      meta.paidWith = charged;
    }
    res.status(202).json({ shoot: await startGeneration(meta, unique) });
  } catch (err) {
    // Nothing was developed: give back whatever was charged and release the claim.
    if (charged === "credit") await users.update(req.user.id, (u) => (u.credits = (u.credits || 0) + 1)).catch((e) => console.error("[generate] refund credit", e.message));
    if (charged === "free") await users.update(req.user.id, (u) => (u.usage = { ...u.usage, freeShootUsed: null })).catch((e) => console.error("[generate] refund free", e.message));
    await del(claimKey).catch(() => {});
    throw err;
  }
});

app.post("/api/shoots/:id/resume", requireUser, async (req, res) => {
  if (req.user.demo) throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  const shoot = await ownShoot(req, res);
  if (!shoot || !requireAI("imaging", res)) return;
  if (LIVE.includes(shoot.status)) return res.status(409).json({ error: "This shoot is still in progress." });
  if (!shoot.shots.some((s) => s.status === "error")) return res.status(400).json({ error: "Nothing to resume." });
  // Retries are free, but capped so a shoot that keeps failing can't loop forever.
  // Counted atomically; a second click in the same moment is ignored, not counted.
  let refused = null;
  const now = Date.now();
  await shoots.updateMeta(shoot.id, (m) => {
    if (LIVE.includes(m.status) || (m.resumeStartedAt && now - Date.parse(m.resumeStartedAt) < 15_000)) refused = "busy";
    else if ((m.resumes || 0) >= MAX_RESUMES) refused = "limit";
    if (refused) return false;
    m.resumes = (m.resumes || 0) + 1;
    m.resumeStartedAt = new Date(now).toISOString();
  });
  if (refused === "busy") return res.status(409).json({ error: "This shoot is still in progress." });
  if (refused === "limit") return res.status(429).json({ error: "These frames still didn't develop after several tries. Contact us and we'll sort it out.", code: "resume_limit" });
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
  let over = false;
  await shoots.updateMeta(shoot.id, (m) => {
    over = plan.tier !== "owner" && (m.regrades || 0) >= FREE.regradesPerShoot;
    if (over) return false;
    m.regrades = (m.regrades || 0) + 1;
  });
  if (over) throw new PlanError(`You can re-grade a shoot up to ${FREE.regradesPerShoot} times.`, "regrade_limit", 429);
  res.status(202).json({ shoot: await startReview(shoot.id) });
});

// Rename a shoot, or set/clear the person's own best pick.
app.patch("/api/shoots/:id", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot) return;
  if (shoot.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
  const body = req.body || {};
  let name;
  if ("name" in body) {
    name = String(body.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: "Give the shoot a name." });
  }
  let pick;
  if ("pickedShotId" in body) {
    const pickId = body.pickedShotId;
    pick = pickId ? shoot.shots.find((s) => s.id === pickId && s.status === "done") : null;
    if (pickId && !pick) return res.status(400).json({ error: "That headshot isn't available to pick." });
  }
  // Atomic, so a grading result landing at the same moment isn't lost.
  await shoots.updateMeta(shoot.id, (meta) => {
    if (name !== undefined) meta.name = name;
    if (pick !== undefined) {
      meta.pickedShotId = pick ? pick.id : null;
      const featured = pick || shoot.shots.find((s) => s.id === meta.review?.bestShotId);
      if (featured) {
        meta.cover = featured.file;
        meta.bestScore = meta.review?.shots?.[featured.id]?.overall ?? null;
      }
    }
  });
  res.json({ shoot: await shoots.get(shoot.id) });
});

app.delete("/api/shoots/:id", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta) return;
  if (meta.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
  if (LIVE.includes(meta.status)) return res.status(409).json({ error: "Wait for the shoot to finish before deleting it." });
  await shoots.remove(meta);
  res.json({ ok: true });
});

/* ------------------------------ Account ----------------------------- */

app.post("/api/account/delete", requireUser, async (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: DEMO_READ_ONLY, code: "demo_read_only" });
  const password = String(req.body?.password || "");
  if (!password || !(await verifyPassword(password, req.user.password))) {
    return res.status(401).json({ error: "That password isn't right.", fields: { password: "That password isn't right." } });
  }
  const list = await shoots.forUser(req.user.id);
  if (list.some((s) => LIVE.includes(s.status))) {
    return res.status(409).json({ error: "One of your shoots is still developing. Wait for it to finish, then delete your account." });
  }
  await users.remove(req.user);
  clearSession(res);
  console.log("[account] deleted", req.user.id);
  res.json({ ok: true });
});

// Account preferences. photoFormat sets which shape the download buttons give
// (every headshot is always available as both).
app.post("/api/account/preferences", requireUser, async (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: DEMO_READ_ONLY, code: "demo_read_only" });
  const want = req.body?.photoFormat;
  if (!PHOTO_FORMATS.some((f) => f.id === want)) return res.status(400).json({ error: "Choose portrait, square or both." });
  const user = await users.update(req.user.id, (u) => (u.photoFormat = want));
  res.json({ user: publicUser(user) });
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
  const origin = appOrigin(req);
  const checkout = await createCheckout(req.user, String(req.body?.packageId || ""), origin, { gpc: gpc(req) });
  const eventId = `checkout_${checkout.id}`;
  trackMeta("InitiateCheckout", { eventId, user: req.user, req, value: checkout.value });
  res.json({ url: checkout.url, eventId, value: checkout.value });
});

app.post("/api/billing/confirm", requireUser, async (req, res) => {
  if (!requireBilling(req, res)) return;
  const result = await confirmCheckout(req.user, req.body?.sessionId);
  res.json({ ...result, user: publicUser(await users.byId(req.user.id)) });
});

app.post("/api/billing/sync", requireUser, async (req, res) => {
  if (!billingEnabled() || req.user.demo) return res.json({ added: 0, removed: 0, user: publicUser(req.user) });
  const { added, removed } = await syncPurchases(req.user);
  res.json({ added, removed, user: publicUser(added || removed ? await users.byId(req.user.id) : req.user) });
});

/* ------------------------------ Contact ----------------------------- */

app.post("/api/contact", async (req, res) => {
  // Honeypot: people never see or fill this field; bots usually do.
  if (req.body?.company) return res.json({ ok: true });
  const { msg, fields } = validateContact(req.body);
  if (Object.keys(fields).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields });
  if (rateLimited(req.ip || "unknown")) return res.status(429).json({ error: "You've sent several messages already. Please try again later." });
  const human = await checkHuman(req.body?.turnstileToken, { ip: req.ip, action: "contact" });
  if (!human.ok) return res.status(400).json({ error: "We couldn't confirm you're a person. Please complete the security check and try again.", code: "bot_check" });
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

// Headshots are 3:4 head-and-shoulders portraits; the square is shown by
// LinkedIn and Teams as a circle, so its corners are lost. With the head
// position from the quality check, the square centres the face (a touch above
// the middle, as portrait photographers do) and keeps room above the hair.
// Without it (older shoots) it falls back to full width from the top, which
// kept the whole head inside the circle on the example set. Never upscaled.
async function squareCrop(buf, head) {
  const img = sharp(buf);
  const { width: W, height: H } = await img.metadata();
  const side = Math.min(W, H);
  const clamp = (v, max) => Math.round(Math.min(Math.max(v, 0), max));
  let top = 0;
  let left = (W - side) / 2;
  if (head) {
    const cy = ((head.top + head.bottom) / 2) * H;
    top = Math.min(cy - side * 0.46, head.top * H - side * 0.1); // at least 10% headroom when the photo has it
    left = ((head.left + head.right) / 2) * W - side / 2;
  }
  return img
    .extract({ left: clamp(left, W - side), top: clamp(top, H - side), width: side, height: side })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

app.get("/media/:sid/:name", requireUser, async (req, res) => {
  const { sid, name } = req.params;
  if (!/^[\w-]+$/.test(sid) || !/^[\w-]+\.(jpg|png)$/.test(name)) return res.status(404).end();
  if (req.query.square && /-sq\.jpg$/.test(name)) return res.status(404).end();
  const meta = await shoots.getMeta(sid);
  if (!meta || meta.userId !== req.user.id) return res.status(404).end();
  const base = name.replace(/\.\w+$/, "");
  if (req.query.square) {
    // 1:1 square for LinkedIn / Microsoft Teams profile photos (see squareCrop).
    // A widened square made by the pipeline (lib/pipeline.js widenSquare) wins;
    // otherwise a face-centered crop of the portrait, cached next to it.
    const shot = (await shoots.get(sid))?.shots.find((s) => s.file === `${sid}/${name}`);
    let sq = shot?.square ? await readMedia(shot.square) : null;
    if (!sq) sq = await readMedia(`${sid}/${base}-sq.jpg`);
    if (!sq) {
      const src = await readMedia(`${sid}/${name}`);
      if (!src) return res.status(404).end();
      sq = await squareCrop(src, shot?.qa?.head || null);
      await writeMedia(`${sid}/${base}-sq.jpg`, sq);
    }
    // Revalidate: a widened square can replace the crop shortly after a frame finishes.
    res.set("Cache-Control", "private, no-cache").type("image/jpeg");
    if (req.query.download) res.attachment(`headshot-${base}-square.jpg`);
    return res.send(sq);
  }
  const buf = await readMedia(`${sid}/${name}`);
  if (!buf) return res.status(404).end();
  const type = name.endsWith(".png") ? "image/png" : "image/jpeg";
  res.set("Cache-Control", "private, max-age=31536000, immutable").type(type);
  if (req.query.download) res.attachment(`headshot-${base}.${name.split(".").pop()}`);
  res.send(buf);
});

/* ----------------------------- Examples ----------------------------- */

// Marketing example headshots (see lib/examples.js).
// /examples/<id>.jpg is the original; /examples/<id>.webp?w=360|600|900 is a
// resized WebP for the pages. Either way the CDN caches the response.
const EXAMPLE_WIDTHS = [360, 600, 900];
app.get(/^\/examples\/([a-z0-9-]+)\.(jpg|webp)$/, async (req, res) => {
  const [id, ext] = [req.params[0], req.params[1]];
  const buf = await exampleImage(id);
  if (!buf) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400");
  if (ext === "jpg") return res.type("image/jpeg").send(buf);
  const w = EXAMPLE_WIDTHS.includes(Number(req.query.w)) ? Number(req.query.w) : 600;
  const out = await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer();
  res.type("image/webp").send(out);
});

// Owner-only generator, enabled only while ADMIN_TOKEN is set.
function adminOnly(req, res, next) {
  const want = process.env.ADMIN_TOKEN || "";
  const got = String(req.query.token || req.get("x-admin-token") || "");
  const digest = (v) => crypto.createHash("sha256").update(v).digest();
  const ok = want.length >= 24 && crypto.timingSafeEqual(digest(got), digest(want));
  if (!ok) return res.status(404).json({ error: "Not found" });
  next();
}
app.get("/api/admin/examples", adminOnly, async (req, res) => res.json({ examples: await exampleStatus() }));
app.get("/api/admin/examples-set/:set", adminOnly, async (req, res) => {
  res.status(202).json({ started: generateExampleSet(req.params.set, { force: req.query.force === "1" }) });
});
app.get("/api/admin/examples-sheet", adminOnly, async (req, res) => {
  const ids = String(req.query.ids || Object.keys(EXAMPLE_JOBS).join(",")).split(",");
  const jpg = await exampleSheet(ids, Math.min(900, Number(req.query.w) || 240), Math.max(1, Number(req.query.cols) || 4), req.query.labels !== "0");
  res.json({ jpeg: jpg ? jpg.toString("base64") : null });
});
app.get("/api/admin/examples/:id/square", adminOnly, async (req, res) => {
  if (!EXAMPLE_JOBS[req.params.id]) return res.status(404).json({ error: "Unknown example." });
  const started = Date.now();
  const bytes = await generateExampleSquare(req.params.id);
  res.json({ ok: true, id: `${req.params.id}-sq`, bytes, ms: Date.now() - started });
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
// Every other GET is the single-page app. lib/seo.js gives each path its own
// title, description, canonical URL and robots rule (plus prerendered content
// for public pages), and unknown paths a real 404 status.
// Content Security Policy for pages. Scripts come from our origin plus
// Turnstile (sign-up, contact) and the Meta pixel; styles allow inline for
// the style="" attributes the views use.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://www.facebook.com",
  "connect-src 'self' https://www.facebook.com https://connect.facebook.net",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.get(/.*/, (req, res) => {
  res.set("Content-Security-Policy", CSP);
  // "//evil.com/" or "/\\evil.com" must never become a redirect to another site.
  if (/^\/[\/\\]/.test(req.path) || req.path.includes("\\")) return res.status(404).type("html").send(pageFor("/__not_found__").html);
  const clean = req.path.length > 1 ? "/" + req.path.replace(/\/+$/, "").replace(/^\/+/, "") : "/";
  if (clean !== req.path) return res.redirect(301, clean + req.url.slice(req.path.length));
  const { status, html } = pageFor(clean);
  if (!isCanonicalHost(req.get("host"))) res.set("X-Robots-Tag", "noindex");
  res.status(status).type("html").send(html);
});

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
