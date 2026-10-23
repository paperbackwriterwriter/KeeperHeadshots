import "./lib/env.js";
import { installErrorAlerts } from "./lib/alert.js";
import express from "express";
import sharp from "sharp";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { users, shoots, id, readMedia, writeMedia, deleteMedia, freeClaimKey, mailboxChecks, canonicalEmail } from "./lib/store.js";
import { backend, createJSON, getJSON, putJSON, updateJSON, del, UNCHANGED } from "./lib/storage.js";
import { runReminders, checkUnsubscribeToken } from "./lib/reminders.js";
import { ogImage } from "./lib/og.js";
import * as showcase from "./lib/showcase.js";
import { CONTACT_TO } from "./lib/contact.js";
import { knownDevice, originDevice, markOrigin, newOriginId, hashPassword, verifyPassword, setSession, clearSession, revokeSession, currentUser, requireUser, publicUser, emailToken, checkEmailToken, emailCode, checkEmailCode, emailVerified, ownsMailbox, resetToken, checkResetToken } from "./lib/auth.js";
import { mailEnabled, sendMail, verificationEmail, passwordResetEmail, teamInviteEmail, MAIL_FROM } from "./lib/mail.js";
import { checkHuman, turnstileSiteKey } from "./lib/turnstile.js";
import * as google from "./lib/google.js";
import { pageFor, blogPostPage, blogIndexPage, blogArticlePage, blogNotFoundPage, blogSitemap, isCanonicalHost } from "./lib/seo.js";
import { blogIndex, blogPost, blogImage, syncBlog } from "./lib/blog.js";
import { searchSite } from "./lib/search.js";
import { isPreview, isKept, watermark } from "./lib/preview.js";
import { reviewShoots, sendOffer } from "./lib/outreach.js";
import { aiStatus, AIError, gateCheck, checkBlocks } from "./lib/ai.js";
import { shootQueueCallback, startLocalShootWorker, ensureShootJob, workerJob, runShootWorker, runDueShootJobs } from "./lib/shoot-jobs.js";
import { listShootPage } from "./lib/shoot-list.js";
import { background, ingestSelfie, beginCheck, runCheck, statusWithoutCheck, advance, startGeneration, retryFailed, startReview, addLooks } from "./lib/pipeline.js";
import { lookFor, MAX_LOOKS, MAX_SELFIES, MAX_RESUMES, MIN_CHECK_SCORE, RECOMMENDED_CHECK_SCORE, PHOTO_FORMATS, isPreviewOffer } from "./public/js/shared/catalog.js";
import { seed, DEMO } from "./scripts/seed.js";
import { customersSection } from "./public/js/shared/customers.js";
import { planFor, ownerEmail, creditSource, PlanError, FREE, DEMO_READ_ONLY, NO_SHOOTS_LEFT, CHOOSE_PACKAGE, EMAIL_UNCONFIRMED } from "./lib/plan.js";
import { browserDetails, gpc, metaPixelId, track as trackMeta } from "./lib/meta.js";
import { runCleanup } from "./lib/cleanup.js";
import { runBackup } from "./lib/backup.js";
import { BUILD, BUILD_FILES } from "./lib/build.js";
import { contactEnabled, validate as validateContact, rateLimited, submit as submitContact } from "./lib/contact.js";
import { JOBS as EXAMPLE_JOBS, status as exampleStatus, generate as generateExample, generateSquare as generateExampleSquare, generateSet as generateExampleSet, exampleImage, sheet as exampleSheet } from "./lib/examples.js";
import crypto from "node:crypto";
import { withCounter, readCounter, overLimit, hashId, DAY_MS } from "./lib/ratelimit.js";
import { recordStep, funnelReport, STEPS } from "./lib/stats.js";
import * as teams from "./lib/teams.js";
import { billingEnabled, createCheckout, confirm as confirmCheckout, sync as syncPurchases, handleWebhook, stripePublishableKey, stripeMode } from "./lib/billing.js";

// Errors logged in production are emailed as a short summary (lib/alert.js).
installErrorAlerts();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
// One hop: Vercel's proxy sets the client address; anything a client adds
// to X-Forwarded-For before that isn't trusted.
app.set("trust proxy", 1);
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
app.use((req, res, next) => {
  if (req.method === "POST" && req.headers["ce-type"] === "com.vercel.queue.v2beta") {
    if (req.headers["ce-vqsqueuename"] !== "keeper-shoots") return res.status(400).end();
    return shootQueueCallback(req, res);
  }
  next();
});
// A body value that is an object with its own toString/valueOf (or a prototype
// key) would make String() throw deep in a route; refuse it up front.
const BAD_KEYS = ["toString", "valueOf", "__proto__", "constructor", "prototype"];
function tainted(v, depth = 0) {
  if (!v || typeof v !== "object") return false;
  if (depth > 6) return true; // deeper than any real request: refuse rather than look further
  if (!Array.isArray(v) && BAD_KEYS.some((k) => Object.prototype.hasOwnProperty.call(v, k))) return true;
  return (Array.isArray(v) ? v : Object.values(v)).some((x) => tainted(x, depth + 1));
}
app.use((req, res, next) => (tainted(req.body) ? res.status(400).json({ error: "That request isn't valid." }) : next()));

// Every API response names the browser-code version, so tabs opened before a
// deploy notice and offer a reload (lib/build.js, public/js/core.js).
console.log(`[build] ${BUILD} (${BUILD_FILES} files)`);
app.use("/api", (req, res, next) => {
  res.set("X-App-Build", BUILD);
  next();
});
// One link of a shoot's worker chain (lib/shoot-jobs.js), started by a signed
// request from this deployment. It answers at once and works in the background.
app.post("/api/internal/shoot-worker", (req, res) => {
  const job = workerJob(req.body);
  if (!job) return res.status(404).end();
  res.status(202).json({ ok: true });
  background(runShootWorker(job));
});

// A shoot's delivery id is for the queue alone; browsers never need it.
app.use("/api/shoots", (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body?.shoot?.jobId) {
      const { jobId, ...shoot } = body.shoot;
      body = { ...body, shoot };
    }
    return json(body);
  };
  next();
});
// Site search: pages, FAQ answers, prices and blog articles (lib/search.js).
// Public and the same for everyone, so the CDN keeps answers for a minute.
app.get("/api/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const index = q.length >= 2 ? await blogIndex().catch(() => null) : null;
  const results = q.length >= 2 ? searchSite(q, { posts: index?.posts }) : [];
  res.set("Cache-Control", "public, max-age=60").set("Vercel-CDN-Cache-Control", "max-age=300, stale-while-revalidate=3600");
  res.json({ q, results });
});
app.get("/api/version", (req, res) => res.set("Cache-Control", "no-store").json({ build: BUILD }));

const isEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
// Links we email or hand to Stripe use a fixed origin in production, never the
// request's Host header (which a client controls).
const appOrigin = (req) => process.env.APP_ORIGIN || (process.env.VERCEL_ENV === "production" ? "https://keeperheadshots.com" : `${req.protocol}://${req.get("host")}`);

const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_FAILS = 10; // per network (IP)
const SIGNIN_MAX_TOTAL = 100; // from everywhere (not for a browser that signed in to it before)
const SIGNIN_MAX_PER_IP = 60; // wrong passwords on any addresses from one network
const SIGNUP_MAX_PER_IP = 120; // new accounts from one network in an hour
const SIGNUP_MAX_PER_MAILBOX = 3; // a day, counting Gmail dots and +tags as one inbox
const DUMMY_HASH = await hashPassword("not-a-real-password");

const LIVE = ["checking", "generating", "reviewing"];
// Funnel counting never fails the request it records (lib/stats.js).
const noteStats = (err) => console.warn("[stats]", err.message);

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
  const { subject, text, html } = verificationEmail({ name: user.name, link, code: emailCode(user) });
  await sendMail({ from: { name: "Keeper Headshots", address: MAIL_FROM }, to: { name: user.name, address: user.email }, subject, text, html });
  return true;
}

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  const errors = {};
  if (!name || String(name).trim().length < 2) errors.name = "Tell us what to call you.";
  else if (String(name).trim().length > 80 || /https?:|www\.|[<>\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/i.test(String(name))) errors.name = "Use just your name (up to 80 characters, no links).";
  if (!isEmail(email)) errors.email = "Enter a valid email address.";
  if (!password || String(password).length < 8) errors.password = "Use at least 8 characters.";
  else if (String(password).length > 200) errors.password = "Use 200 characters or fewer.";
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  // Bot check first, so the "already exists" answer can't be scraped by scripts.
  const human = await checkHuman(req.body?.turnstileToken, { ip: req.ip, action: "signup" });
  if (!human.ok) return res.status(400).json({ error: "We couldn't confirm you're a person. Please complete the security check and try again.", code: "bot_check" });
  // A script making accounts to flood an inbox with codes (one mailbox under
  // many +tags) or to burn through email sends is stopped here.
  if (await overLimit("signup", req.ip, SIGNUP_MAX_PER_IP)) return res.status(429).json({ error: "Too many new accounts from your network right now. Please try again later." });
  const exists = () => res.status(400).json({ error: "Please fix the highlighted fields.", fields: { email: "An account with this email already exists. Sign in instead?" } });
  if (await users.byEmail(email)) return exists();
  if (await overLimit("signupmail", canonicalEmail(email), SIGNUP_MAX_PER_MAILBOX, DAY_MS)) return res.status(429).json({ error: "This inbox has created a few accounts today. Sign in to one of them, or try again tomorrow.", fields: { email: "This inbox has created a few accounts today. Sign in instead?" } });
  const user = await users.create({
    id: id("usr"),
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    password: await hashPassword(String(password)),
    createdAt: new Date().toISOString(),
    emailVerified: false,
    verifySends: [Date.now()],
    originDevice: newOriginId(),
  });
  if (!user) return exists(); // the same address signed up a moment ago
  setSession(res, user);
  markOrigin(res, user);
  // Meta's CompleteRegistration fires when the email is confirmed (below).
  const verificationSent = await sendVerification(user, req).catch((err) => {
    console.error("[verify] send failed", user.id, err.message);
    return false;
  });
  if (!ownerEmail(user.email)) background(recordStep("signup", user).catch(noteStats));
  res.status(201).json({ user: publicUser(user), verificationSent });
});

app.post("/api/auth/signin", async (req, res) => {
  const { email, password } = req.body || {};
  // One network failing on many addresses (credential stuffing) is stopped
  // before anything else is looked up or written.
  const netKey = hashId(req.ip || "unknown").slice(0, 16);
  const netFails = await readCounter("signinnet", netKey, SIGNIN_WINDOW_MS).catch(() => ({}));
  if ((netFails.n || 0) >= SIGNIN_MAX_PER_IP) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again, or reset your password." });
  if (isEmail(email) && email.toLowerCase().trim() === DEMO.email) await seed();
  const user = isEmail(email) ? await users.byEmail(email) : null;
  const known = knownDevice(req, user);
  // Slow down password guessing without letting a stranger lock someone out:
  // per email address, 10 wrong passwords from one network (IP) refuse that
  // network, and 100 from everywhere refuse all sign-ins, counting the
  // current 15-minute window and the one before it, so guesses either side of
  // a window's start still add up (lib/ratelimit.js, shared by every server). The attempt is recorded atomically before the password is
  // checked (so a burst of parallel guesses counts every one) and taken back
  // on success. Unknown addresses are counted too, so neither the timing nor
  // a 429 reveals which addresses have accounts. The demo account's password
  // is public, so it isn't counted (nobody could lock it for everyone).
  const counted = isEmail(email) && !user?.demo;
  const addr = counted ? email.toLowerCase().trim() : null;
  const net = hashId(req.ip || "unknown").slice(0, 12);
  let locked = false;
  if (counted) {
    const prev = await readCounter("signin", addr, SIGNIN_WINDOW_MS, 1).catch(() => ({}));
    locked = await withCounter("signin", addr, SIGNIN_WINDOW_MS, (r) => {
      const fromHere = r.ips?.[net] || 0;
      if (fromHere + (prev.ips?.[net] || 0) >= SIGNIN_MAX_FAILS || (!known && (r.total || 0) + (prev.total || 0) >= SIGNIN_MAX_TOTAL)) return true;
      r.ips = { ...r.ips, [net]: fromHere + 1 };
      r.total = (r.total || 0) + 1;
      return false;
    }).catch((err) => (console.error("[signin] attempt counter", err.message), false));
  }
  if (locked) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again, or reset your password." });
  // Always run the (async) password hash, even for unknown emails, so timing
  // doesn't reveal which addresses have accounts.
  // An account made with Google (or taken over by its inbox's owner) has no
  // password: the dummy hash only keeps the timing the same, it never matches.
  const ok = (await verifyPassword(String(password || "").slice(0, 1000), user?.password || DUMMY_HASH)) && !!user?.password;
  if (!user || !password || !ok) {
    await withCounter("signinnet", netKey, SIGNIN_WINDOW_MS, (r) => void (r.n = (r.n || 0) + 1)).catch(() => {});
    return res.status(401).json({ error: "That email and password don't match an account." });
  }
  if (counted) {
    const forgive = (r) => {
      if (!r.ips?.[net]) return;
      r.total = Math.max(0, (r.total || 0) - r.ips[net]);
      r.ips = { ...r.ips, [net]: 0 };
    };
    await Promise.all([0, 1].map((back) => withCounter("signin", addr, SIGNIN_WINDOW_MS, forgive, back))).catch(() => {});
  }
  setSession(res, user);
  res.json({ user: publicUser(user) });
});

// "Continue with Google" (lib/google.js). Google has confirmed the address, so
// the account counts as confirmed straight away. An existing account with the
// same address is signed in (and linked). If that account was never confirmed,
// whoever made it never proved the inbox was theirs, so its password is
// removed and its other sessions end: the inbox's owner takes it over.
const safeNextPath = (next) => (typeof next === "string" && /^\/(app(\/|$|\?)|join$)/.test(next) ? next : null);
const googleRedirectUri = (req) => `${appOrigin(req)}/api/auth/google/callback`;
const nameOk = (s) => typeof s === "string" && s.trim().length >= 2 && s.trim().length <= 80 && !/https?:|www\.|[<>\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/i.test(s);
const googleCookie = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" || !!process.env.VERCEL, path: "/api/auth/google" };

app.get("/api/auth/google", (req, res) => {
  if (!google.googleEnabled()) return res.status(404).end();
  const { url, cookie } = google.begin({ redirectUri: googleRedirectUri(req), next: safeNextPath(req.query.next), signup: req.query.mode === "signup" });
  res.cookie(google.STATE_COOKIE, cookie, { ...googleCookie, maxAge: google.STATE_MAX_AGE_MS });
  res.set("Cache-Control", "no-store").redirect(302, url);
});

app.get("/api/auth/google/callback", async (req, res) => {
  if (!google.googleEnabled()) return res.status(404).end();
  const flow = google.readFlow(req.cookies?.[google.STATE_COOKIE]);
  res.clearCookie(google.STATE_COOKIE, googleCookie);
  res.set("Cache-Control", "no-store");
  const back = (code) => res.redirect(302, `${flow?.signup ? "/signup" : "/signin"}?google=${code}${safeNextPath(flow?.next) ? `&next=${encodeURIComponent(flow.next)}` : ""}`);
  // Pressing Cancel on Google's page comes back with error=access_denied.
  if (req.query.error) return back("cancelled");
  if (!flow || !google.stateMatches(flow, req.query.state)) return back("expired");
  // The flow cookie isn't signed, so its destination is checked again here.
  const next = safeNextPath(flow.next);
  let profile;
  try {
    profile = await google.finish({ code: req.query.code, flow, redirectUri: googleRedirectUri(req) });
  } catch (err) {
    console.warn("[google]", err instanceof google.GoogleError ? err.message : err);
    return back("failed");
  }
  if (profile.email === DEMO.email) return back("failed");
  const now = new Date().toISOString();
  let user = await users.byEmail(profile.email);
  let created = false;
  let newlyVerified = false;
  if (!user) {
    const local = profile.email.split("@")[0].replace(/[^\p{L}\p{N} ._'-]/gu, " ").trim();
    const name = [profile.name, profile.givenName, local].find(nameOk)?.trim() || "Keeper member";
    user = await users.create({ id: id("usr"), name, email: profile.email, googleSub: profile.sub, createdAt: now, emailVerified: true, emailVerifiedAt: now, signupMethod: "google" });
    if (user) created = newlyVerified = true;
    else user = await users.byEmail(profile.email); // the same address signed up a moment ago
    if (!user) return back("failed");
  }
  if (!created) {
    // Already linked to a different Google account with this address (a
    // reassigned work address, say): don't hand that account over.
    if (user.googleSub && user.googleSub !== profile.sub) {
      console.warn("[google] address linked to another Google account", user.id);
      return back("failed");
    }
    // Taken over from the browser that made the account: it's the same person.
    const sameDevice = originDevice(req, user);
    user = await users.update(user.id, (u) => {
      newlyVerified = false;
      if (u.googleSub && u.googleSub !== profile.sub) throw new google.GoogleError("linked to another Google account");
      if (u.googleSub === profile.sub && ownsMailbox(u)) return UNCHANGED;
      u.googleSub = profile.sub;
      // Nobody had proved this inbox was theirs (never confirmed, or only
      // confirmed by accepting a team invitation someone else sent): whoever
      // set the password may not be its owner, so it goes, with their sessions.
      if (!ownsMailbox(u)) {
        newlyVerified = u.emailVerified === false;
        if (u.password) delete u.password;
        u.sessionVersion = (u.sessionVersion || 0) + 1;
        u.revokedSessions = [];
        u.emailVerified = true;
        u.emailVerifiedAt = now;
        delete u.emailVerifiedVia;
      }
    }).catch((err) => (err instanceof google.GoogleError ? null : Promise.reject(err)));
    if (!user) return back("failed"); // deleted meanwhile, or linked elsewhere
    if (newlyVerified && !sameDevice) await purgeForTakeover(user.id);
  }
  if (created) background(recordStep("signup", user).catch(noteStats));
  if (newlyVerified) {
    trackMeta("CompleteRegistration", { eventId: `reg_${user.id}`, user, req });
    background(recordStep("verified", user).catch(noteStats));
  }
  setSession(res, user);
  console.log("[google]", created ? "signed up" : "signed in", user.id);
  // The page shows a welcome and, for a new account, sends the Pixel's
  // CompleteRegistration with the server's event id (deduplicated); an
  // existing account confirmed this way is counted by the server's event.
  const dest = next || (created ? "/app/new" : "/app");
  res.redirect(302, `${dest}${dest.includes("?") ? "&" : "?"}auth=${created ? "google-new" : newlyVerified ? "google-verified" : "google"}`);
});

app.post("/api/auth/verify", async (req, res) => {
  const { user, error } = await checkEmailToken(req.body?.token);
  if (error === "invalid") return res.status(400).json({ error: "This confirmation link isn't valid. Make sure you copied the whole link, or ask for a new one.", code: "invalid" });
  const me = await currentUser(req);
  if (ownsMailbox(user)) return res.json({ status: "already", user: me ? publicUser(me) : null });
  // The link confirms the address; it never signs anyone in. (Signing in from
  // it would let someone send their own unclicked link to another person and
  // have that person work, and upload photos, inside the sender's account.)
  if (error === "expired") return res.status(410).json({ error: "This confirmation link has expired. Ask for a new one below.", code: "expired", signedIn: me?.id === user.id });
  const { updated, eventId } = await markVerified(user, req);
  res.json({ status: "verified", user: me?.id === user.id ? publicUser(updated) : me ? publicUser(me) : null, eventId });
});

function confirmEmail(u) {
  u.emailVerified = true;
  u.emailVerifiedAt = new Date().toISOString();
  delete u.emailVerifiedVia;
}
function afterVerified(updated, req) {
  const eventId = `reg_${updated.id}`;
  trackMeta("CompleteRegistration", { eventId, user: updated, req });
  background(recordStep("verified", updated).catch(noteStats));
  return eventId;
}
async function markVerified(user, req) {
  const updated = await users.update(user.id, confirmEmail);
  return { updated, eventId: afterVerified(updated, req) };
}

// The 6-digit code from the same email (lib/auth.js), typed on the page the
// person is signed in on. It confirms only the signed-in account.
app.post("/api/auth/verify/code", requireUser, async (req, res) => {
  if (ownsMailbox(req.user)) return res.json({ status: "already", user: publicUser(req.user) });
  // Guessing limits: a few tries an hour per account and per connection, and
  // 20 in all per account, after which only the emailed link works. A daily
  // limit per mailbox (Gmail dots and +tags count as one) stops someone
  // deleting and re-creating the account to get fresh tries.
  const tooMany = { error: "Too many tries. Use the link in the email instead, or wait a while.", code: "rate_limited" };
  // The four counters are independent writes: made together, not one by one.
  const limits = await Promise.all([overLimit("verifycode", req.user.id, 8), overLimit("verifycodeaddr", hashId(req.user.email), 8), overLimit("verifycodeip", req.ip || "unknown", 30), overLimit("verifycodemailbox", canonicalEmail(req.user.email), 20, DAY_MS)]);
  if (limits.some(Boolean)) return res.status(429).json(tooMany);
  // Counting the try and confirming the address are one write.
  let spent = false;
  let right = false;
  const updated = await users.update(req.user.id, (u) => {
    spent = (u.verifyCodeTries || 0) >= 20;
    right = false;
    if (spent) return UNCHANGED;
    u.verifyCodeTries = (u.verifyCodeTries || 0) + 1;
    right = checkEmailCode(u, req.body?.code);
    if (right) confirmEmail(u);
  });
  if (spent) return res.status(429).json(tooMany);
  if (!right) {
    return res.status(400).json({ error: "That code isn't right. Check the latest email from us, or use its link.", fields: { code: "That code isn't right." } });
  }
  const eventId = afterVerified(updated, req);
  console.log("[verify] confirmed by code", req.user.id);
  res.json({ status: "verified", user: publicUser(updated), eventId });
});

app.post("/api/auth/verify/resend", requireUser, async (req, res) => {
  if (ownsMailbox(req.user)) return res.json({ status: "already", user: publicUser(req.user) });
  if (!mailEnabled()) return res.status(503).json({ error: "Email isn't set up on this site yet. Please contact us." });
  const now = Date.now();
  let status;
  // Reserve before contacting the provider. The atomic update rechecks fresh
  // account data on every storage retry, so concurrent requests cannot reuse
  // the same allowance or overwrite another request's timestamps.
  const user = await users.update(req.user.id, (u) => {
    const sends = (u.verifySends || []).filter((t) => now - t < 24 * 60 * 60 * 1000);
    status = ownsMailbox(u) ? "already" : sends.some((t) => now - t < 60 * 1000) ? "recent" : sends.length >= 5 ? "daily" : "send";
    if (status !== "send") return UNCHANGED;
    u.verifySends = [...sends, now];
  });
  if (status === "already") return res.json({ status: "already", user: publicUser(user) });
  if (status === "recent") return res.status(429).json({ error: "A confirmation email was requested recently. Wait a minute before trying again, and check your spam folder too." });
  if (status === "daily") return res.status(429).json({ error: "You've requested several confirmation emails today. Check your spam folder, or contact us and we'll help." });
  try {
    if (!(await sendVerification(user, req))) return res.status(503).json({ error: "Email isn't set up on this site yet. Please contact us." });
  } catch (err) {
    // Keep the reservation: a provider can accept an email before its reply
    // fails. Refunding that attempt would let retries bypass the send limits.
    console.error("[verify] resend failed", req.user.id, err.message);
    return res.status(502).json({ error: "We couldn't send the email just now. Please try again in a few minutes." });
  }
  res.json({ status: "sent", email: user.email });
});

app.post("/api/auth/signout", async (req, res) => {
  try {
    await revokeSession(req);
  } catch (err) {
    // An account part-way through deletion has no sessions worth keeping:
    // let the browser sign out rather than trapping it in a signed-in state.
    if (err.status !== 410) {
      console.error("[signout] revoke", err.message);
      return res.status(503).json({ error: "Sign-out is temporarily unavailable. Please try again." });
    }
  }
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
  // Everything after the lookup happens after answering, so neither the
  // response nor its timing reveals whether the address has an account.
  const user = await users.byEmail(email);
  res.json({ status: "sent" });
  if (!user || user.demo) return;
  const origin = appOrigin(req);
  background(
    (async () => {
      // Record the send atomically first, so parallel requests can't get past the limit.
      const now = Date.now();
      let allowed = false;
      await users.update(user.id, (u) => {
        const sends = (u.resetSends || []).filter((t) => now - t < RESET_WINDOW_MS);
        allowed = sends.length < RESET_MAX_SENDS && !(sends.length && now - sends[sends.length - 1] < 60 * 1000);
        if (!allowed) return UNCHANGED;
        u.resetSends = [...sends, now];
      });
      if (!allowed) return;
      const link = `${origin}/reset?token=${resetToken(user)}`;
      const { subject, text, html } = passwordResetEmail({ name: user.name, link });
      await sendMail({ from: { name: "Keeper Headshots", address: MAIL_FROM }, to: { name: user.name, address: user.email }, subject, text, html });
    })().catch((err) => console.error("[reset] send failed", user.id, err.message)),
  );
});

// Step 2 sets the new password, signs out every other device (by bumping the
// session version) and signs this browser in.
// The reset page checks its link when it opens, so an expired or used link
// says so straight away rather than after a new password has been typed.
// Nothing changes here; the link is only used by the reset itself.
app.post("/api/auth/password/reset/check", async (req, res) => {
  if (await overLimit("resetcheck", req.ip || "unknown", 60)) return res.status(429).json({ error: "Too many attempts. Please wait a little and try again." });
  const { error } = await checkResetToken(req.body?.token);
  if (error === "expired") return res.status(410).json({ error: "This reset link has expired. Ask for a new one below.", code: "expired" });
  if (error) return res.status(400).json({ error: "This reset link isn't valid or has already been used. Ask for a new one below.", code: "invalid" });
  res.json({ ok: true });
});

app.post("/api/auth/password/reset", async (req, res) => {
  const { token, password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: { password: "Use at least 8 characters." } });
  if (String(password).length > 200) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: { password: "Use at most 200 characters." } });
  const invalid = () => res.status(400).json({ error: "This reset link isn't valid or has already been used. Ask for a new one below.", code: "invalid" });
  const { user, error } = await checkResetToken(token);
  if (error === "expired") return res.status(410).json({ error: "This reset link has expired. Ask for a new one below.", code: "expired" });
  if (error) return invalid();
  const hash = await hashPassword(String(password));
  const at = new Date().toISOString();
  let used = false;
  let newlyVerified = false;
  // Reset from the browser that made the account: it's the same person.
  const sameDevice = originDevice(req, user);
  const updated = await users.update(user.id, (u) => {
    // Another request already used this link (the password changed since we checked).
    used = u.password !== user.password;
    if (used) return;
    u.password = hash;
    u.passwordChangedAt = at;
    u.sessionVersion = (u.sessionVersion || 0) + 1;
    delete u.signinFails; // replaced by the shared counter below
    u.resetSends = [];
    // The link came from their inbox, so this also confirms the email address.
    newlyVerified = u.emailVerified === false;
    if (newlyVerified) {
      u.emailVerified = true;
      u.emailVerifiedAt = at;
    }
    delete u.emailVerifiedVia;
  });
  if (used) return invalid();
  if (newlyVerified && !sameDevice) await purgeForTakeover(user.id);
  // Proving they own the inbox lifts any sign-in lock on the address.
  const lift = (r) => {
    r.ips = {};
    r.total = 0;
  };
  await Promise.all([0, 1].map((back) => withCounter("signin", user.email.toLowerCase(), SIGNIN_WINDOW_MS, lift, back))).catch(() => {});
  if (newlyVerified) {
    trackMeta("CompleteRegistration", { eventId: `reg_${user.id}`, user: updated, req });
    background(recordStep("verified", updated).catch(noteStats));
  }
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
  const optOut = gpc(req);
  // Session and privacy settings belong to this request, never a shared cache.
  res.set("Cache-Control", "private, no-store");
  res.json({ user: user ? publicUser(user) : null, ai: { vision, imaging }, meta: { pixelId: optOut ? null : metaPixelId(), optOut }, turnstile: { siteKey: turnstileSiteKey() }, google: google.googleEnabled(), stripe: { publishableKey: stripePublishableKey(), mode: stripeMode() } });
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
  team: s.team ? s.team.name : null,
});

app.get("/api/shoots", requireUser, async (req, res) => {
  const page = await listShootPage(req.user.id, { cursor: req.query.cursor ?? null, limit: req.query.limit === undefined ? 24 : Number(req.query.limit) });
  // Members who joined a team before accounts recorded it (lib/teams.js
  // accept sets joinedTeam): a team shoot here says they're on one.
  const teamShoot = !req.user.joinedTeam && page.shoots.find((s) => s.team?.id);
  const user = teamShoot ? await users.update(req.user.id, (u) => (u.joinedTeam ? UNCHANGED : void (u.joinedTeam = teamShoot.team.id))).catch(() => null) : null;
  res.json({ shoots: page.shoots.map(summary), nextCursor: page.nextCursor, ...(user ? { user: publicUser(user) } : {}) });
});

// Managed shoots move through durable deliveries even with no open browser.
app.get("/api/shoots/:id", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot) return;
  // The durable delivery normally does the work. If no frame is being worked
  // on (the queue is slow or not delivering), an open page moves the shoot on
  // itself; frame and review claims keep any frame from rendering twice.
  const busy = (shoot.shots || []).some((s) => s.status === "rendering" && Date.now() - Date.parse(s.startedAt) < 90_000)
    || (shoot.status === "reviewing" && shoot.reviewWorkerAt && Date.now() - Date.parse(shoot.reviewWorkerAt) < 90_000);
  if (!LIVE.includes(shoot.status) || (shoot.jobId && busy)) return res.json({ shoot });
  // Upgrade earlier live shoots to a durable delivery.
  if (!shoot.jobId) await ensureShootJob(shoot.id).catch((err) => console.error("[shoot-job] upgrade", shoot.id, err.message));
  const moved = await advance(shoot.id, shoot).catch((err) => (console.error("[advance]", shoot.id, err.message), null));
  res.json({ shoot: await shoots.get(shoot.id) || moved || shoot });
});

app.post("/api/shoots", requireUser, async (req, res) => {
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  if (plan.needsEmail) throw new PlanError(EMAIL_UNCONFIRMED, "email_unconfirmed", 403);
  if (!plan.canDevelop) throw new PlanError(plan.started ? NO_SHOOTS_LEFT : CHOOSE_PACKAGE);
  const mine = await shoots.forUser(req.user.id);
  const drafts = mine.filter((s) => !s.sample && !(s.shots || []).length).length;
  if (drafts >= MAX_DRAFTS) return res.status(409).json({ error: `You have ${drafts} shoots that haven't been developed yet. Develop or delete one to start another.`, code: "too_many_drafts" });
  const count = mine.length + 1;
  const now = new Date().toISOString();
  const shoot = await shoots.create({
    id: id("sht"),
    userId: req.user.id,
    name: (req.body?.name && String(req.body.name).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60)) || `Shoot No. ${String(count).padStart(2, "0")}`,
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

// Undeveloped shoots an account can have at once, and photos it can upload
// an hour: far above real use, but each photo is decoded and stored, so
// there's a ceiling.
const MAX_DRAFTS = 20;
const UPLOADS_PER_HOUR = 150;

// Photo checks per day for accounts past the free allowance (each is a paid
// AI call). Generous for real use: about seven re-checks of every shoot.
const DAILY_CHECKS = 40;

// Photos can be added or removed until developing starts, so a person can
// top up their set after the photo check without losing what they uploaded.
const canEditPhotos = (meta) => !meta.sample && ["draft", "checked", "error"].includes(meta.status) && !(meta.shots || []).length;

app.post("/api/shoots/:id/selfies", requireUser, async (req, res) => {
  if (req.user.demo) throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  const meta = await ownShoot(req, res, { full: false });
  if (!meta) return;
  if (!canEditPhotos(meta)) return res.status(400).json({ error: "Photos can't be changed once developing has started. Start a new shoot instead." });
  if (meta.selfies.length >= MAX_SELFIES) return res.status(400).json({ error: `Up to ${MAX_SELFIES} photos per shoot. Remove one to make room.` });
  if (await overLimit("uploads", req.user.id, UPLOADS_PER_HOUR)) return res.status(429).json({ error: "That's a lot of photos in one hour. Please wait a little and try again." });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(req.body?.photo || "");
  if (!m) return res.status(400).json({ error: "Photos must be JPG, PNG or WebP." });
  const selfie = await ingestSelfie(meta.id, Buffer.from(m[2], "base64"));
  // Added atomically, re-checking the rules against the stored shoot, so
  // parallel uploads can't drop each other or go past the limit.
  let refused = null;
  let count = 0;
  await shoots.updateMeta(meta.id, (fresh) => {
    if (!canEditPhotos(fresh)) refused = "Photos can't be changed once developing has started. Start a new shoot instead.";
    else if (fresh.selfies.length >= MAX_SELFIES) refused = `Up to ${MAX_SELFIES} photos per shoot. Remove one to make room.`;
    if (refused) return false;
    fresh.selfies.push(selfie);
    count = fresh.selfies.length;
    // The set changed, so the old check no longer describes it.
    Object.assign(fresh, { check: null, status: "draft", error: null });
  });
  if (refused) {
    await deleteMedia(selfie.file).catch(() => {});
    return res.status(400).json({ error: refused });
  }
  res.status(201).json({ selfie, count });
});

app.delete("/api/shoots/:id/selfies/:name", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta) return;
  if (!canEditPhotos(meta)) return res.status(400).json({ error: "Photos can't be changed once developing has started." });
  const file = `${meta.id}/${req.params.name}`;
  let problem = null;
  let removed = null;
  await shoots.updateMeta(meta.id, (m) => {
    const index = m.selfies.findIndex((s) => s.file === file);
    if (!canEditPhotos(m)) problem = [400, "Photos can't be changed once developing has started."];
    else if (index < 0) problem = [404, "That photo isn't in this shoot."];
    else if (m.selfies.length <= 1) problem = [400, "A shoot needs at least one photo."];
    if (problem) return false;
    [removed] = m.selfies.splice(index, 1);
    // Keep the rest of the photo check, re-pointed at the remaining photos.
    if (m.check?.photos) {
      m.check.photos = m.check.photos.filter((p) => p.index !== index).map((p) => (p.index > index ? { ...p, index: p.index - 1 } : p));
    }
  });
  if (problem) return res.status(problem[0]).json({ error: problem[1] });
  await deleteMedia(removed.file);
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

// A develop claim older than this with nothing developed is one a crashed
// instance left behind (see the generate route).
const STALE_CLAIM_MS = Number(process.env.STALE_CLAIM_MS || 2 * 60 * 1000);

app.post("/api/shoots/:id/check", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta || !requireAI("vision", res)) return;
  if (meta.sample) return res.status(400).json({ error: "Sample shoots are read-only. Start a new shoot to use your own photos." });
  if (!meta.selfies.length) return res.status(400).json({ error: "Add at least one photo first." });
  if (meta.status === "checking") return res.status(409).json({ error: "A photo check is already running for this shoot." });
  if (!canEditPhotos(meta)) return res.status(409).json({ error: "This shoot has already been developed. Start a new shoot to check new photos." });
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  // A team shoot can go ahead on the invitation alone (lib/teams.js).
  if (plan.needsEmail && !(meta.team && emailVerified(req.user))) throw new PlanError(EMAIL_UNCONFIRMED, "email_unconfirmed", 403);
  const limitMsg = `Free accounts include ${FREE.checks} photo checks, and you've used them. Buy a package to keep going.`;
  // A team seat was paid for by the admin (lib/teams.js), and a free reshoot
  // costs nothing (see /reshoot), so the free allowance neither gates it nor is
  // spent on it; only the daily cap applies. A reshoot's first few checks are
  // free; after that they count like any other. They're counted on the
  // original, so deleting and remaking the reshoot doesn't start them again.
  const reshootOriginal = await reshootGrant(meta, req.user.id);
  const freeReshoot = !!reshootOriginal && (reshootOriginal.reshootChecks || 0) < RESHOOT_FREE_CHECKS;
  // (A seat the admin's refund left unpaid is the person's own check again.)
  const teamSeat = (!!meta.team && meta.paidWith === "team" && (await teams.seatPaid(meta).catch(() => false))) || freeReshoot;
  // Customers pay up front: with no package (and no free shoot), a shoot
  // can't be developed, so its photos aren't checked either (each check is a
  // paid AI call). Team shoots and free reshoots still are.
  if (plan.tier === "none" && !teamSeat) throw new PlanError(plan.started ? "Buy a package to check photos and develop this shoot." : CHOOSE_PACKAGE);
  // Before the free shoot (no address for this mailbox has had it), checks
  // past the free allowance come from a daily one instead, so nobody is left
  // unable to see a result without buying.
  const beforeShoot = async () => plan.tier === "trial" && !plan.needsEmail && !(await getJSON(freeClaimKey(req.user.email)).catch(() => null));
  let extra = false;
  if (plan.checksLeft === 0 && !teamSeat) {
    if (!(await beforeShoot())) throw new PlanError(limitMsg);
    extra = true;
  }
  const extraDayMsg = `That's ${FREE.checksPerDayBeforeShoot} photo checks today. You can check more photos tomorrow, or start your free shoot with photos that passed.`;
  // One check at a time per shoot: a double-click doesn't run (or count) twice.
  const startedAt = await beginCheck(meta.id);
  if (!startedAt) return res.status(409).json({ error: "A photo check is already running for this shoot." });
  // Reserve the check before the (paid) AI call so parallel requests can't
  // exceed the allowance; give it back if the check fails. Free accounts have
  // a lifetime allowance; paid accounts a generous daily one (each check is a
  // paid AI call, and a package alone shouldn't make them unlimited).
  const counted = plan.tier !== "owner";
  // Free checks are shared by every address for the same mailbox.
  const perMailbox = plan.checksLeft != null && !teamSeat;
  let mailboxReserved = false;
  let mailboxTotal = 0;
  const today = new Date().toISOString().slice(0, 10);
  const dayMsg = `That's ${DAILY_CHECKS} photo checks today. You can check more photos tomorrow.`;
  let extraReserved = false;
  try {
    if (perMailbox && !extra) {
      const total = await mailboxChecks.reserve(req.user.email, FREE.checks, req.user.usage?.checks || 0);
      if (total === null) {
        await users.update(req.user.id, (u) => (u.usage = { ...u.usage, checks: Math.max(u.usage?.checks || 0, FREE.checks) })).catch(() => {});
        // The last free check went to another request just now.
        if (!(await beforeShoot())) throw new PlanError(limitMsg);
        extra = true;
      } else {
        mailboxReserved = true;
        mailboxTotal = total;
      }
    }
    if (extra) {
      if (!(await mailboxChecks.reserveToday(req.user.email, FREE.checksPerDayBeforeShoot, today))) throw new PlanError(extraDayMsg, "daily_checks", 429);
      extraReserved = true;
    }
    if (counted) {
      await users.update(req.user.id, (u) => {
        // (A reserved mailbox check is this request's, whatever another
        // request has just written to the account's count.)
        if (!teamSeat && !extra && !mailboxReserved && planFor(u).checksLeft === 0) throw new PlanError(limitMsg);
        const day = u.usage?.checkDay?.date === today ? u.usage.checkDay.n : 0;
        if (day >= DAILY_CHECKS) throw new PlanError(dayMsg, "daily_checks", 429);
        // Shows what's left for the whole mailbox, not just this address.
        u.usage = { ...u.usage, ...(teamSeat || extra ? {} : { checks: Math.max((u.usage?.checks || 0) + 1, mailboxTotal) }), checkDay: { date: today, n: day + 1 } };
      });
    }
  } catch (err) {
    if (mailboxReserved) await mailboxChecks.release(req.user.email);
    if (extraReserved) await mailboxChecks.releaseToday(req.user.email, today);
    await shoots.updateMeta(meta.id, (m) => (m.status === "checking" && m.checkStartedAt === startedAt ? void Object.assign(m, { status: statusWithoutCheck(m) }) : false)).catch(() => {});
    throw err;
  }
  try {
    await runCheck(meta.id, startedAt);
    background(recordStep("checked", req.user).catch(noteStats));
    if (freeReshoot) await shoots.updateMeta(reshootOriginal.id, (m) => void (m.reshootChecks = (m.reshootChecks || 0) + 1)).catch(() => {});
    // A check that asks for new selfies doesn't use up a free check: retaking
    // them isn't held against anyone. (It still counts toward the daily cap.)
    const checked = await shoots.getMeta(meta.id).catch(() => null);
    if (checked?.check?.verdict === "retake" && checked.checkStartedAt === startedAt) {
      if (mailboxReserved) await mailboxChecks.release(req.user.email);
      // (A check past the free allowance, before the free shoot, still counts
      // toward that day's allowance: it's the cap on these.)
      if (counted && !teamSeat && !extra) await users.update(req.user.id, (u) => void (u.usage = { ...u.usage, checks: Math.max(0, (u.usage?.checks || 0) - 1) })).catch(() => {});
      // Going ahead with these photos anyway (generate) counts it after all.
      if (mailboxReserved) await shoots.updateMeta(meta.id, (m) => (m.check && m.checkStartedAt === startedAt ? void (m.check.refunded = true) : false)).catch(() => {});
    }
  } catch (err) {
    if (mailboxReserved) await mailboxChecks.release(req.user.email);
    if (extraReserved) await mailboxChecks.releaseToday(req.user.email, today);
    if (counted)
      await users
        .update(req.user.id, (u) => {
          const d = u.usage?.checkDay;
          u.usage = { ...u.usage, ...(teamSeat || extra ? {} : { checks: Math.max(0, (u.usage?.checks || 0) - 1) }), ...(d?.date === today ? { checkDay: { date: today, n: Math.max(0, d.n - 1) } } : {}) };
        })
        .catch(() => {});
    throw err;
  }
  res.json({ shoot: await shoots.get(meta.id) });
});

app.post("/api/shoots/:id/generate", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta || !requireAI("imaging", res) || !requireAI("vision", res)) return;
  if (meta.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
  if (!meta.check) return res.status(400).json({ error: "Run the photo check first." });
  // Under MIN_CHECK_SCORE a set never develops: new selfies first. A retake
  // above it (under RECOMMENDED_CHECK_SCORE, or judged one) goes ahead only
  // when the person chose to continue anyway. Older checks are held to this too.
  if (checkBlocks(meta.check)) return res.status(400).json({ error: `These photos scored ${meta.check.overall_score}, and a shoot needs at least ${MIN_CHECK_SCORE} so your headshots look like you. Follow the directions on this page, add new selfies and re-check.`, code: "retake_needed" });
  if (gateCheck({ ...meta.check }).verdict === "retake" && !req.body?.override) return res.status(400).json({ error: `These photos scored ${meta.check.overall_score}; we recommend ${RECOMMENDED_CHECK_SCORE} or more. Add new selfies, or continue with these anyway.`, code: "retake_recommended" });
  if (LIVE.includes(meta.status)) return res.status(409).json({ error: "This shoot is already in progress." });
  // A shoot is developed once; retries of failed frames go through /resume.
  if (meta.status !== "checked" || (meta.shots || []).length) return res.status(409).json({ error: "This shoot has already been developed. Start a new shoot for new looks." });
  // A team shoot always uses the team's looks, whatever is sent, and a free
  // reshoot the original shoot's looks (copied onto it when it was made).
  const reshootFrom = meta.reshootOf && !meta.team ? await reshootGrant(meta, req.user.id) : null;
  const asked = meta.team ? meta.team.looks : reshootFrom ? meta.looks : req.body?.looks;
  const looks = (Array.isArray(asked) ? asked : []).map((l) => (l && typeof l === "object" ? lookFor(String(l.backdrop), String(l.outfit)) : null)).filter(Boolean);
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
    // A claim left behind by a develop that died between charging and writing
    // the plan (the shoot is still "checked" with nothing developed) is taken
    // over after a couple of minutes; the charge it made is reused below.
    // Taken over atomically: of several requests at once, exactly one wins.
    let won = false;
    await updateJSON(claimKey, (left) => {
      won = false; // the callback may run again after a write conflict
      const stale = left && left.userId === req.user.id && Date.now() - Date.parse(left.at || 0) > STALE_CLAIM_MS;
      if (!stale) return UNCHANGED;
      won = true;
      return { userId: req.user.id, at: new Date().toISOString(), retaken: true };
    }).catch(() => null);
    if (!won) return res.status(409).json({ error: "This shoot is already in progress." });
  }
  let charged = null;
  let paidBy = null;
  let reshootMarked = null;
  try {
    // A team shoot was paid for when its invite was sent, unless a refund since took that back.
    if (meta.team && !(await teams.seatPaid(meta))) throw new PlanError("This team shoot is no longer paid for. Ask your team admin to buy a package or get in touch with us.", "team_unpaid", 402);
    const original = await reshootGrant(meta, req.user.id);
    // A reshoot whose original is gone (deleted) develops like any other shoot.
    if (meta.reshootOf && !original) {
      delete meta.reshootOf;
      delete meta.reshootLooks;
    }
    if (original) {
      if (unique.length > (meta.reshootLooks || 1)) throw new PlanError(`Your free reshoot includes up to ${meta.reshootLooks || 1} look${(meta.reshootLooks || 1) === 1 ? "" : "s"}. Remove ${unique.length - (meta.reshootLooks || 1)} to continue.`, "too_many_looks", 400);
      // The free reshoot is used once it develops (deleting it doesn't give it
      // back): marked before developing, and given back below if that fails.
      let marked = false;
      await shoots.updateMeta(original.id, (m) => {
        marked = false; // the callback may run again after a write conflict
        if (m.reshootId !== meta.id || (m.reshootUsed && m.reshootUsed !== meta.id)) return false;
        m.reshootUsed = meta.id;
        marked = true;
      });
      if (!marked) throw new PlanError("This free reshoot has already been used.", "reshoot_used", 409);
      reshootMarked = original.id;
      meta.paidWith = "reshoot";
      if (original.preview) meta.preview = true;
    } else if (plan.tier !== "owner" && !meta.team) {
      if (plan.needsEmail && !plan.credits) throw new PlanError(EMAIL_UNCONFIRMED, "email_unconfirmed", 403);
      // One free shoot per mailbox, however the address is written.
      // Only a mailbox its owner confirmed can claim it (a paid but unconfirmed
      // account develops from its credits instead).
      const wantsFree = plan.freeShootAvailable && ownsMailbox(req.user) && unique.length <= FREE.looks;
      let freeOk = false;
      if (wantsFree) {
        const key = freeClaimKey(req.user.email);
        freeOk = (await createJSON(key, { userId: req.user.id, shootId: meta.id, at: new Date().toISOString() })) || (await getJSON(key))?.userId === req.user.id;
      }
      await users.update(req.user.id, (u) => {
        charged = null; // the callback may run again after a write conflict
        paidBy = null;
        const p = planFor(u);
        // Charged by an earlier try that died before the plan was written: don't charge again.
        const before = u.developing?.[meta.id];
        const kind = typeof before === "object" ? before?.charged : before;
        if (kind === "free" || kind === "credit") {
          charged = kind;
          paidBy = before?.paidBy || null;
          return UNCHANGED;
        }
        if (freeOk && p.freeShootAvailable && ownsMailbox(u)) {
          u.usage = { ...u.usage, freeShootUsed: meta.id };
          charged = "free";
        } else if (p.credits > 0) {
          paidBy = creditSource(u);
          u.credits = p.credits - 1;
          charged = "credit";
        } else if (wantsFree && !freeOk) {
          throw new PlanError("The free shoot has already been used for this email address. Buy a package to keep going.", "free_used");
        } else if (p.freeShootAvailable && unique.length > FREE.looks) {
          throw new PlanError(`Your free shoot includes up to ${FREE.looks} looks. Remove ${unique.length - FREE.looks} to continue.`, "too_many_looks", 400);
        } else {
          throw new PlanError(p.started ? NO_SHOOTS_LEFT : CHOOSE_PACKAGE);
        }
        u.developing = { ...u.developing, [meta.id]: paidBy ? { charged, paidBy } : charged };
      });
      meta.paidWith = charged;
      if (paidBy) meta.paidBy = paidBy;
      // The free shoot is a watermarked preview until a package is bought (lib/preview.js).
      if (charged === "free") meta.preview = true;
    }
    const started = await startGeneration(meta, unique);
    reshootMarked = null;
    // A photo check given back as a retake counts after all when the person
    // goes ahead with those photos.
    if (meta.check?.refunded && req.body?.override && planFor(req.user).checksLeft != null) background(countRefundedCheck(req.user).catch(() => {}));
    if (charged) await users.update(req.user.id, (u) => (u.developing?.[meta.id] ? void delete u.developing[meta.id] : UNCHANGED)).catch(() => {});
    background(recordStep("developed", req.user).catch(noteStats));
    res.status(202).json({ shoot: started });
  } catch (err) {
    // Nothing was developed: give back what was charged, once. The charge is
    // recorded on the account (u.developing) until the shoot starts, so the
    // refund and the record's removal are one write: two failing requests
    // can't both refund it, and a charge the shoot did use is never refunded.
    if (charged) {
      let refunded = null;
      await users.update(req.user.id, (u) => {
        refunded = null;
        const memo = u.developing?.[meta.id];
        if (!memo) return UNCHANGED;
        const kind = typeof memo === "object" ? memo.charged : memo;
        delete u.developing[meta.id];
        if (kind === "credit") teams.giveBack(u);
        if (kind === "free" && u.usage?.freeShootUsed === meta.id) u.usage = { ...u.usage, freeShootUsed: null };
        refunded = kind;
      }).catch((e) => console.error("[generate] refund", e.message));
      if (refunded === "free") {
        // The mailbox's free-shoot claim comes back with it.
        const freeKey = freeClaimKey(req.user.email);
        if ((await getJSON(freeKey).catch(() => null))?.shootId === meta.id) await del(freeKey).catch(() => {});
      }
    }
    if (reshootMarked) await shoots.updateMeta(reshootMarked, (m) => (m.reshootUsed === meta.id ? void delete m.reshootUsed : false)).catch(() => {});
    await del(claimKey).catch(() => {});
    throw err;
  }
});

// Counts one free photo check (see the check endpoint's retake refund).
async function countRefundedCheck(user) {
  const total = await mailboxChecks.reserve(user.email, FREE.checks, user.usage?.checks || 0);
  if (total === null) return;
  await users.update(user.id, (u) => void (u.usage = { ...u.usage, checks: Math.max((u.usage?.checks || 0) + 1, total) }));
}

// Extra looks bought with a preview offer ("Preview + 2 more looks"): they're
// added to that shoot and developed. The credit is taken first, atomically,
// and given back if the shoot can't take them.
app.post("/api/shoots/:id/more-looks", requireUser, async (req, res) => {
  const meta = await ownShoot(req, res, { full: false });
  if (!meta || !requireAI("imaging", res) || !requireAI("vision", res)) return;
  const have = req.user.extraLooks?.[meta.id] || 0;
  if (!have) return res.status(400).json({ error: "This shoot has no extra looks to add." });
  if (LIVE.includes(meta.status)) return res.status(409).json({ error: "This shoot is still in progress." });
  const existing = new Set((meta.looks || []).map((l) => lookFor(l.backdrop, l.outfit)?.id));
  const asked = Array.isArray(req.body?.looks) ? req.body.looks : [];
  const looks = [...new Map(asked.map((l) => (l && typeof l === "object" ? lookFor(String(l.backdrop), String(l.outfit)) : null)).filter((l) => l && !existing.has(l.id)).map((l) => [l.id, l])).values()];
  if (!looks.length) return res.status(400).json({ error: "Pick a look this shoot doesn't have yet." });
  if (looks.length > have) return res.status(400).json({ error: `Pick up to ${have} look${have === 1 ? "" : "s"}.` });
  if (existing.size + looks.length > MAX_LOOKS) return res.status(400).json({ error: `A shoot has at most ${MAX_LOOKS} looks. Pick ${Math.max(0, MAX_LOOKS - existing.size)} or fewer.` });
  let taken = false;
  await users.update(req.user.id, (u) => {
    taken = false;
    const left = u.extraLooks?.[meta.id] || 0;
    if (left < looks.length) return UNCHANGED;
    u.extraLooks = { ...u.extraLooks, [meta.id]: left - looks.length };
    if (!u.extraLooks[meta.id]) delete u.extraLooks[meta.id];
    taken = true;
  });
  if (!taken) return res.status(409).json({ error: "Those looks have already been added." });
  const giveBack = () => users.update(req.user.id, (u) => void (u.extraLooks = { ...u.extraLooks, [meta.id]: (u.extraLooks?.[meta.id] || 0) + looks.length })).catch((e) => console.error("[more-looks] refund", e.message));
  try {
    if (!(await addLooks(meta.id, looks))) {
      await giveBack();
      return res.status(409).json({ error: "This shoot is busy. Try again in a moment." });
    }
  } catch (err) {
    await giveBack();
    throw err;
  }
  res.status(202).json({ shoot: await shoots.get(meta.id), user: publicUser(await users.byId(req.user.id)) });
});

app.post("/api/shoots/:id/resume", requireUser, async (req, res) => {
  if (req.user.demo) throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  const shoot = await ownShoot(req, res);
  if (!shoot || !requireAI("imaging", res)) return;
  if (LIVE.includes(shoot.status)) return res.status(409).json({ error: "This shoot is still in progress." });
  // Pending frames on a stopped shoot (an interrupted retry) are resumable too.
  if (!shoot.shots.some((s) => s.status === "error" || s.status === "pending")) return res.status(400).json({ error: "Nothing to resume." });
  // Retries are free, but capped so a shoot that keeps failing can't loop forever.
  // Counted atomically; a second click in the same moment is ignored, not counted.
  let refused = null;
  const now = Date.now();
  await shoots.updateMeta(shoot.id, (m) => {
    refused = null; // the callback may run again after a write conflict
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

// A free reshoot: when our quality check held back several frames because
// they didn't look enough like the person, the selfies are usually why, so a
// new shoot with new selfies costs nothing (no credit, free shoot or free
// photo check). One per developed shoot, with the same looks; the new shoot
// keeps the original's preview status. The original records the reshoot
// (reshootId) and the reshoot points back (reshootOf): both must match for
// the reshoot to develop free.
const heldForLikeness = (shoot) => (shoot.shots || []).filter((t) => t.status === "error" && (t.qa?.history?.at(-1)?.likeness ?? 10) < 8).length;
const RESHOOT_MIN_HELD = 2;
// Photo checks on a reshoot that don't use the free allowance.
const RESHOOT_FREE_CHECKS = 3;

async function reshootGrant(meta, userId) {
  if (!meta?.reshootOf) return null;
  const original = await shoots.getMeta(meta.reshootOf).catch(() => null);
  return original && original.userId === userId && original.reshootId === meta.id ? original : null;
}

app.post("/api/shoots/:id/reshoot", requireUser, async (req, res) => {
  if (req.user.demo) throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  const shoot = await ownShoot(req, res);
  if (!shoot) return;
  if (shoot.reshootUsed) return res.status(409).json({ error: "This shoot's free reshoot has already been used.", code: "reshoot_used" });
  if (shoot.sample || shoot.team || shoot.reshootOf) return res.status(400).json({ error: "This shoot can't be reshot free. Contact us and we'll sort it out.", code: "reshoot_unavailable" });
  if (LIVE.includes(shoot.status)) return res.status(409).json({ error: "This shoot is still in progress." });
  if (heldForLikeness(shoot) < RESHOOT_MIN_HELD) return res.status(400).json({ error: "A free reshoot is for shoots where several headshots were held back for likeness.", code: "reshoot_unavailable" });
  // Asked again: the reshoot already made, while it's still waiting for photos.
  if (shoot.reshootId) {
    const made = await shoots.getMeta(shoot.reshootId).catch(() => null);
    if (made && made.userId === req.user.id) {
      if ((made.shots || []).length) return res.status(409).json({ error: "This shoot's free reshoot has already been used.", code: "reshoot_used" });
      return res.json({ shoot: made });
    }
  }
  const sid = id("sht");
  const was = shoot.reshootId || null;
  let won = false;
  await shoots.updateMeta(shoot.id, (m) => {
    won = false; // the callback may run again after a write conflict
    if ((m.reshootId || null) !== was) return false;
    m.reshootId = sid;
    won = true;
  });
  if (!won) return res.status(409).json({ error: "A reshoot is already being set up. Refresh the page.", code: "reshoot_busy" });
  const looks = (shoot.looks || []).filter((l) => lookFor(l.backdrop, l.outfit)).map((l) => ({ backdrop: l.backdrop, outfit: l.outfit })).slice(0, MAX_LOOKS);
  try {
    const made = await shoots.create({
      id: sid,
      userId: req.user.id,
      name: `${String(shoot.name || "Shoot").slice(0, 49)} · reshoot`,
      status: "draft",
      createdAt: new Date().toISOString(),
      selfies: [],
      check: null,
      looks,
      shots: [],
      review: null,
      error: null,
      reshootOf: shoot.id,
      reshootLooks: Math.max(1, looks.length),
    });
    console.log("[reshoot]", shoot.id, "->", sid, "held", heldForLikeness(shoot));
    res.status(201).json({ shoot: made });
  } catch (err) {
    await shoots.updateMeta(shoot.id, (m) => (m.reshootId === sid ? void (m.reshootId = was) : false)).catch(() => {});
    throw err;
  }
});

app.post("/api/shoots/:id/review", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot || !requireAI("vision", res)) return;
  if (!shoot.shots.some((s) => s.status === "done")) return res.status(400).json({ error: "There are no finished headshots to grade yet." });
  if (LIVE.includes(shoot.status)) return res.status(409).json({ error: "This shoot is still in progress." });
  const plan = planFor(req.user);
  if (plan.tier === "demo") throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  if (plan.tier !== "owner" && (shoot.regrades || 0) >= FREE.regradesPerShoot) throw new PlanError(`You can re-grade a shoot up to ${FREE.regradesPerShoot} times.`, "regrade_limit", 429);
  // Counted in the same write that starts the grading, so a start that's
  // refused (already grading, or developing again) doesn't use one.
  const next = await startReview(shoot.id, (m) => {
    if (plan.tier !== "owner" && (m.regrades || 0) >= FREE.regradesPerShoot) throw new PlanError(`You can re-grade a shoot up to ${FREE.regradesPerShoot} times.`, "regrade_limit", 429);
    m.regrades = (m.regrades || 0) + 1;
  });
  res.status(202).json({ shoot: next });
});

// Rename a shoot, or set/clear the person's own best pick.
app.patch("/api/shoots/:id", requireUser, async (req, res) => {
  const shoot = await ownShoot(req, res);
  if (!shoot) return;
  if (shoot.sample) return res.status(400).json({ error: "Sample shoots are read-only." });
  const body = req.body || {};
  let name;
  if ("name" in body) {
    name = String(body.name || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60);
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
  await shoots.remove(meta);
  // Its free reshoot, if not yet developed, becomes an ordinary shoot.
  if (meta.reshootId && !meta.reshootUsed) await shoots.updateMeta(meta.reshootId, (m) => (m.reshootOf === meta.id && !(m.shots || []).length ? void (delete m.reshootOf, delete m.reshootLooks) : false)).catch(() => {});
  // Headshots kept from it and unused extra looks for it go with it.
  await users.update(req.user.id, (u) => {
    if (!u.kept?.[meta.id] && !u.extraLooks?.[meta.id]) return UNCHANGED;
    if (u.kept) delete u.kept[meta.id];
    if (u.extraLooks) delete u.extraLooks[meta.id];
  }).catch((err) => console.error("[shoot] delete cleanup", meta.id, err.message));
  await showcase.removeForShoot(meta.id).catch((err) => console.error("[showcase] remove", meta.id, err.message));
  // A team shoot deleted before developing gives the shoot back to the admin.
  if (meta.team && !(meta.shots || []).length) await teams.returnSeat(meta).catch((err) => console.error("[team] return seat", meta.id, err.message));
  res.json({ ok: true });
});

/* ------------------------------- Teams ------------------------------ */

// Team orders (lib/teams.js): an admin buys shoots and invites colleagues.
const lookNames = (looks) => looks.map((l) => {
  const x = lookFor(l.backdrop, l.outfit);
  return x ? `${x.backdrop.name} · ${x.outfit.name}` : "";
});

function teamAdminOnly(req, res) {
  if (req.user.demo) throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  if (planFor(req.user).needsEmail) throw new PlanError(EMAIL_UNCONFIRMED, "email_unconfirmed", 403);
  // Invitations go out in this person's name with their address to reply
  // to, so the address must be theirs (customers no longer confirm it to
  // get started, so this is checked here).
  if (!ownsMailbox(req.user)) throw new PlanError("Confirm your email address before setting up a team: enter the 6-digit code from our email on your Account page.", "email_unconfirmed", 403);
  return true;
}

// Invitations: at most INVITES_PER_HOUR a team admin, and at most
// INVITE_EMAILS_PER_DAY emails to one address a day (inviting, cancelling and
// inviting again, or resending), so the form can't be used to flood a mailbox.
const INVITES_PER_HOUR = 30;
const INVITE_EMAILS_PER_DAY = 3;
const inviteMailCapped = (team, inv) => overLimit("invite-mail", canonicalEmail(inv.email), INVITE_EMAILS_PER_DAY, DAY_MS);
async function sendInvite(req, team, inv) {
  if (!mailEnabled()) return false;
  if (await inviteMailCapped(team, inv)) return "capped";
  const link = `${appOrigin(req)}/join/${inv.token}`;
  const { subject, text, html } = teamInviteEmail({ ownerName: req.user.name, teamName: team.name, link, looks: lookNames(team.looks) });
  await sendMail({ from: { name: "Keeper Headshots", address: MAIL_FROM }, replyTo: { name: req.user.name, address: req.user.email }, to: inv.email, subject, text, html });
  await teams.markSent(team.id, inv.id);
  return true;
}

// The admin's team: its looks and each person's progress.
app.get("/api/team", requireUser, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const team = await teams.teamStatus(req.user);
  // Listing can lapse an invitation and hand its shoot back, so the page
  // gets the account as it is now, not as it was when it loaded.
  const user = (await users.byId(req.user.id)) || req.user;
  res.json({ team, credits: planFor(user).credits || 0, email: mailEnabled(), user: publicUser(user) });
});

app.post("/api/team", requireUser, async (req, res) => {
  teamAdminOnly(req, res);
  await teams.saveTeam(req.user, { name: req.body?.name, looks: req.body?.looks });
  const user = await users.byId(req.user.id);
  res.json({ team: await teams.teamStatus(user), user: publicUser(user) });
});

// Invites one or more addresses (comma, space or line separated). Each uses
// one of the admin's shoots; the answer lists what happened to each address.
app.post("/api/team/invites", requireUser, async (req, res) => {
  teamAdminOnly(req, res);
  const emails = [...new Set(String(req.body?.emails || "").split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean))].slice(0, 25);
  if (!emails.length) return res.status(400).json({ error: "Add at least one email address." });
  const results = [];
  for (const email of emails) {
    // Each address counts towards the hourly limit, however they're batched.
    if (await overLimit("invites", req.user.id, INVITES_PER_HOUR)) {
      results.push({ email, ok: false, error: "That's a lot of invites in one hour. Please wait a little and try again." });
      continue;
    }
    try {
      const user = await users.byId(req.user.id); // fresh balance and team for each
      const { team, invite: inv } = await teams.invite(user, email);
      const sent = await sendInvite(req, team, inv).catch((err) => (console.error("[team] invite email", err.message), false));
      results.push({ email: inv.email, ok: true, sent: sent === true, ...(sent === "capped" ? { capped: true } : {}), link: `${appOrigin(req)}/join/${inv.token}` });
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      results.push({ email, ok: false, error: err.message });
    }
  }
  const user = await users.byId(req.user.id);
  res.json({ results, team: await teams.teamStatus(user), user: publicUser(user) });
});

app.post("/api/team/invites/:inviteId/resend", requireUser, async (req, res) => {
  teamAdminOnly(req, res);
  const team = await teams.getTeam(req.user.teamId);
  const inv = team?.invites?.[req.params.inviteId];
  if (!inv || inv.status !== "invited") return res.status(404).json({ error: "That invite isn't open any more." });
  if (inv.sentAt && Date.now() - Date.parse(inv.sentAt) < 60_000) return res.status(429).json({ error: "We just sent it. Give it a minute, and ask them to check their spam folder." });
  const sent = await sendInvite(req, team, inv);
  if (sent === "capped") return res.status(429).json({ error: `We've emailed ${inv.email} ${INVITE_EMAILS_PER_DAY} times today. Copy the invite link and send it yourself instead.` });
  if (!sent) return res.status(503).json({ error: "Email isn't set up here. Copy the invite link and send it yourself." });
  res.json({ ok: true });
});

// The invite link, for sending it yourself.
app.get("/api/team/invites/:inviteId/link", requireUser, async (req, res) => {
  const team = await teams.getTeam(req.user.teamId);
  const inv = team?.ownerId === req.user.id ? team.invites?.[req.params.inviteId] : null;
  if (!inv || inv.status !== "invited") return res.status(404).json({ error: "That invite isn't open any more." });
  res.json({ link: `${appOrigin(req)}/join/${inv.token}` });
});

app.delete("/api/team/invites/:inviteId", requireUser, async (req, res) => {
  teamAdminOnly(req, res);
  if (!(await teams.cancelInvite(req.user, req.params.inviteId))) return res.status(409).json({ error: "Only invites that haven't been accepted can be cancelled." });
  const user = await users.byId(req.user.id);
  res.json({ team: await teams.teamStatus(user), user: publicUser(user) });
});

// The invitation page: who invited you, for which team. No sign-in needed to
// look; accepting needs the invited address.
app.get("/api/join/:token", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const found = await teams.readInvite(req.params.token);
  if (!found) return res.status(404).json({ error: "This invitation isn't valid any more. Ask your team admin for a new one." });
  const { team, invite: inv } = found;
  const me = await currentUser(req);
  res.json({
    team: { name: team.name, ownerName: team.ownerName, looks: lookNames(team.looks) },
    email: inv.email,
    status: inv.status,
    mine: !!me && inv.status === "joined" && inv.userId === me.id ? inv.shootId : null,
  });
});

app.post("/api/join/:token", requireUser, async (req, res) => {
  if (req.user.demo) throw new PlanError(DEMO_READ_ONLY, "demo_read_only", 403);
  const { shootId } = await teams.accept(req.user, req.params.token);
  res.json({ shootId, user: publicUser(await users.byId(req.user.id)) });
});

/* ------------------------------ Account ----------------------------- */

// The inbox's owner took over, from another device, an account someone else
// made with their address and never confirmed (password reset or Google
// sign-in). What that person uploaded isn't theirs to keep: drafts go, with
// their photos, and so do the uploaded selfies of finished shoots. Shoots
// that were developed (paid for) stay, with their headshots: customers pay
// before confirming their address now, so those are most likely the owner's
// own paid work. (A shoot still developing keeps its selfies until it's done:
// its frames are rendered from them.) Purchases stay (they're payment
// records), and so does the balance. A takeover from the device that made the account is its
// owner, and keeps everything. An account confirmed by a team invitation keeps
// its shoots too: they're a member's paid work, and the admin can't win a seat
// back by taking over an address they invited.
async function purgeForTakeover(userId) {
  const list = [];
  const kept = [];
  for (const meta of await shoots.forUser(userId)) ((meta.shots || []).length ? kept : list).push(meta);
  for (const meta of kept) {
    if (meta.status !== "done" || !(meta.selfies || []).length) continue;
    let files = [];
    await shoots.updateMeta(meta.id, (m) => {
      files = (m.selfies || []).map((s) => s.file);
      if (!files.length) return false;
      m.selfies = [];
      if (m.check?.photos) m.check.photos = [];
    }).catch((err) => console.error("[takeover] selfies", meta.id, err.message));
    for (const file of files) await deleteMedia(file).catch((err) => console.error("[takeover] selfie", file, err.message));
  }
  if (!list.length) return 0;
  const gone = new Set(list.map((meta) => meta.id));
  for (const meta of list) if (meta.team && !(meta.shots || []).length) await teams.returnSeat(meta).catch((err) => console.error("[takeover] return seat", meta.id, err.message));
  await showcase.removeForUser(userId).catch(() => {});
  for (const meta of list) await shoots.remove(meta);
  // A develop caught mid-charge (its shoot is gone now) gives its charge back,
  // as a failed develop would: the balance stays with the account.
  let freeBack = null;
  const owner = await users.update(userId, (u) => {
    freeBack = null;
    for (const field of ["kept", "extraLooks"]) {
      if (u[field]) u[field] = Object.fromEntries(Object.entries(u[field]).filter(([sid]) => !gone.has(sid)));
    }
    for (const [sid, memo] of Object.entries(u.developing || {})) {
      if (!gone.has(sid)) continue;
      const kind = typeof memo === "object" ? memo?.charged : memo;
      if (kind === "credit") teams.giveBack(u);
      if (kind === "free" && u.usage?.freeShootUsed === sid) {
        u.usage = { ...u.usage, freeShootUsed: null };
        freeBack = sid;
      }
    }
    if (u.developing) for (const sid of gone) delete u.developing[sid];
  }).catch(() => null);
  if (freeBack && owner) {
    const freeKey = freeClaimKey(owner.email);
    if ((await getJSON(freeKey).catch(() => null))?.shootId === freeBack) await del(freeKey).catch(() => {});
  }
  console.log("[takeover] removed", list.length, "shoot(s) made before the address was confirmed", userId);
  return list.length;
}

app.post("/api/account/delete", requireUser, async (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: DEMO_READ_ONLY, code: "demo_read_only" });
  // An account made with Google has no password: typing its email confirms.
  if (!req.user.password) {
    if (String(req.body?.email || "").toLowerCase().trim() !== req.user.email) return res.status(401).json({ error: "That email doesn't match this account.", fields: { password: "That email doesn't match this account." } });
  } else {
    const password = String(req.body?.password || "");
    // Not a place to guess the password from a borrowed session.
    if (await overLimit("delete", req.user.id, 10)) return res.status(429).json({ error: "Too many attempts. Please wait a little and try again." });
    if (!password || !(await verifyPassword(password, req.user.password))) {
      return res.status(401).json({ error: "That password isn't right.", fields: { password: "That password isn't right." } });
    }
  }
  // Revoke work before listing: concurrent uploads, develops and late workers
  // must not restore photos after their account has requested erasure.
  await users.beginRemoval(req.user.id);
  const list = await shoots.forUser(req.user.id);
  // An undeveloped team shoot goes back to its team; your own team closes.
  for (const meta of list) if (meta.team && !(meta.shots || []).length) await teams.returnSeat(meta).catch((err) => console.error("[team] return seat", meta.id, err.message));
  if (req.user.teamId) await teams.removeTeam(req.user.teamId);
  // Teams they were a member of keep the seat, not their name or address.
  await teams.forgetMemberEverywhere(req.user.id);
  await showcase.removeForUser(req.user.id);
  await users.remove(req.user);
  // The funnel keeps its day totals; the per-person "already counted" markers go.
  await del(STEPS.map((step) => `stats/seen/${step}/${req.user.id}.json`)).catch(noteStats);
  clearSession(res);
  console.log("[account] deleted", req.user.id);
  res.json({ ok: true });
});

// Account preferences. photoFormat sets which shape the download buttons give
// (every headshot is always available as both).
app.post("/api/account/preferences", requireUser, async (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: DEMO_READ_ONLY, code: "demo_read_only" });
  const want = req.body?.photoFormat;
  const reminders = req.body?.reminders;
  if (want === undefined && typeof reminders !== "boolean") return res.status(400).json({ error: "Nothing to change." });
  if (want !== undefined && !PHOTO_FORMATS.some((f) => f.id === want)) return res.status(400).json({ error: "Choose portrait, square or both." });
  const user = await users.update(req.user.id, (u) => {
    if (want !== undefined) u.photoFormat = want;
    if (reminders === true) delete u.remindersOff;
    if (reminders === false) u.remindersOff = u.remindersOff || new Date().toISOString();
  });
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
  // At most 10 checkouts started an hour per account (a person needs one or
  // two); stops scripts from flooding Stripe with sessions.
  const now = Date.now();
  let tooMany = false;
  await users.update(req.user.id, (u) => {
    const recent = (u.checkoutStarts || []).filter((t) => now - t < 60 * 60 * 1000);
    tooMany = recent.length >= 10;
    u.checkoutStarts = tooMany ? recent : [...recent, now];
  });
  if (tooMany) return res.status(429).json({ error: "You've started several checkouts in the last hour. Please try again a little later, or contact us." });
  const embedded = req.body?.embedded === true && !!stripePublishableKey();
  const packageId = String(req.body?.packageId || "");
  // A preview offer is for one of this account's finished free previews that
  // nothing has unlocked yet; "Keep your pick" also names the one headshot.
  let shootId = null;
  let shotId = null;
  if (isPreviewOffer(packageId)) {
    shootId = String(req.body?.shootId || "");
    const meta = /^sht_[\w-]{6,40}$/.test(shootId) ? await shoots.getMeta(shootId) : null;
    if (!meta || meta.userId !== req.user.id) return res.status(400).json({ error: "Choose the shoot to keep first." });
    if (!isPreview(meta, req.user)) return res.status(400).json({ error: "This shoot is already yours to keep. Pick a package to keep shooting.", code: "not_preview" });
    if (meta.status !== "done") return res.status(400).json({ error: "Wait for this shoot to finish, then keep it." });
    if (packageId === "keep") {
      shotId = String(req.body?.shotId || "");
      const shot = (await shoots.get(shootId))?.shots.find((s) => s.id === shotId && s.status === "done");
      if (!shot) return res.status(400).json({ error: "Pick the headshot to keep first." });
      if (isKept(req.user, shootId, shotId)) return res.status(400).json({ error: "That headshot is already yours. Pick another one, or keep them all.", code: "kept" });
    }
  }
  const checkout = await createCheckout(req.user, packageId, origin, { gpc: gpc(req), embedded, shootId, shotId, toTeam: req.body?.returnTo === "team", browser: browserDetails(req) });
  // For the one "unfinished checkout" reminder (lib/reminders.js).
  // (Packages only: an offer is reminded about by the preview's "buy" email.)
  if (!shootId) await users.update(req.user.id, (u) => void (u.lastCheckout = { packageId, at: new Date().toISOString() })).catch((err) => console.error("[checkout] record", err.message));
  const eventId = `checkout_${checkout.id}`;
  trackMeta("InitiateCheckout", { eventId, user: req.user, req, value: checkout.value });
  res.json(embedded ? { clientSecret: checkout.clientSecret, eventId, value: checkout.value } : { url: checkout.url, eventId, value: checkout.value });
});

// The buy page reports here when Stripe's embedded form fails to load (it
// then falls back to the hosted page), so the reason reaches the logs.
app.post("/api/billing/embed-error", requireUser, (req, res) => {
  console.warn("[checkout] embedded form failed for", req.user.id, "-", String(req.body?.message || "").slice(0, 300).replace(/[\r\n]+/g, " "));
  res.json({ ok: true });
});

// Both call Stripe, whose API rate limit the whole site shares, so each
// account gets a ceiling. A skipped sync is silent (the webhook and the next
// visit catch up).
app.post("/api/billing/confirm", requireUser, async (req, res) => {
  if (!requireBilling(req, res)) return;
  const sessionId = req.body?.sessionId;
  if (typeof sessionId !== "string" || !/^cs_\w{4,200}$/.test(sessionId)) return res.status(400).json({ error: "That checkout link isn't valid." });
  if (await overLimit("confirm", req.user.id, 30)) return res.status(429).json({ error: "Please wait a minute, then refresh this page." });
  const result = await confirmCheckout(req.user, sessionId);
  res.json({ ...result, user: publicUser(await users.byId(req.user.id)) });
});

app.post("/api/billing/sync", requireUser, async (req, res) => {
  if (!billingEnabled() || req.user.demo || !req.user.stripeCustomerId || (await overLimit("sync", req.user.id, 20))) return res.json({ added: 0, removed: 0, user: publicUser(req.user) });
  const { added, removed, revoked } = await syncPurchases(req.user, { automatic: req.body?.automatic === true });
  res.json({ added, removed, user: publicUser(added || removed || revoked ? await users.byId(req.user.id) : req.user) });
});

/* ------------------------------ Contact ----------------------------- */

app.post("/api/contact", async (req, res) => {
  // Honeypot: people never see or fill this field; bots usually do.
  if (req.body?.company) return res.json({ ok: true });
  const { msg, fields } = validateContact(req.body);
  if (Object.keys(fields).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields });
  if (await rateLimited(req.ip || "unknown")) return res.status(429).json({ error: "You've sent several messages already. Please try again later." });
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

// The square crop of a headshot: a widened square made by the pipeline
// (lib/pipeline.js widenSquare) wins; otherwise a face-centered crop of the
// portrait, cached next to it.
async function squareOf(sid, name, shot) {
  const base = name.replace(/\.\w+$/, "");
  let sq = shot?.square ? await readMedia(shot.square) : null;
  if (!sq) sq = await readMedia(`${sid}/${base}-sq.jpg`);
  if (!sq) {
    const src = await readMedia(`${sid}/${name}`);
    if (!src) return null;
    sq = await squareCrop(src, shot?.qa?.head || null);
    await writeMedia(`${sid}/${base}-sq.jpg`, sq);
  }
  return sq;
}

// Ready-made sizes, made on first download and cached next to the headshot:
//   linkedin  800×800 JPEG profile photo (LinkedIn asks for at least 400×400)
//   banner    1584×396 LinkedIn background in the colors of this headshot's
//             backdrop (the area above the head, softly blurred), so the
//             profile photo sits on a matching banner
//   signature 256×256 round PNG with transparent corners, for email
//             signatures, Slack and badges
const SIZES = {
  linkedin: { suffix: "li.jpg", type: "image/jpeg", label: "linkedin" },
  banner: { suffix: "banner.jpg", type: "image/jpeg", label: "linkedin-banner" },
  signature: { suffix: "sig.png", type: "image/png", label: "signature" },
};
async function makeSize(size, sid, name, shot) {
  if (size === "linkedin") {
    const sq = await squareOf(sid, name, shot);
    return sq && sharp(sq).resize(800, 800).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }
  if (size === "signature") {
    const sq = await squareOf(sid, name, shot);
    if (!sq) return null;
    const d = 256;
    const circle = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);
    return sharp(sq).resize(d, d).composite([{ input: circle, blend: "dest-in" }]).png({ compressionLevel: 9 }).toBuffer();
  }
  if (size === "banner") {
    const src = await readMedia(`${sid}/${name}`);
    if (!src) return null;
    const { width: W, height: H } = await sharp(src).metadata();
    // The backdrop above the head (from the quality check's head box), or the
    // top tenth of the frame when there's no box.
    const headTop = shot?.qa?.head?.top;
    const h = Math.max(24, Math.round(H * Math.min(0.3, Math.max(0.08, (Number.isFinite(headTop) ? headTop : 0.1) * 0.85))));
    return sharp(await sharp(src).extract({ left: 0, top: 0, width: W, height: h }).toBuffer())
      .resize(1584, 396, { fit: "cover" })
      .blur(24)
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  }
  return null;
}

// Watermarked previews, most recently used last (see /media below).
const previewCache = new Map();
// A download link opened after signing out is a page navigation, so it goes
// to the sign-in page (and back to the shoot) instead of saving an error as a file.
async function mediaUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (user) {
      req.user = user;
      return next();
    }
    if (req.method === "GET" && (req.query.download || /text\/html/.test(req.headers.accept || ""))) return res.redirect(302, `/signin?next=${encodeURIComponent(`/app/shoot/${req.params.sid}`)}`);
    res.status(401).json({ error: "Please sign in to continue.", code: "signed_out" });
  } catch (err) {
    next(err);
  }
}
app.get("/media/:sid/:name", mediaUser, async (req, res) => {
  const { sid, name } = req.params;
  if (!/^[\w-]+$/.test(sid) || !/^[\w-]+\.(jpg|png)$/.test(name)) return res.status(404).end();
  const derived = /-(sq|li|banner|sig)\.(jpg|png)$/.test(name);
  if ((req.query.square || req.query.size) && derived) return res.status(404).end();
  const meta = await shoots.getMeta(sid);
  if (!meta) return res.status(404).end();
  // The member, or their team admin for a finished headshot (never selfies).
  if (meta.userId !== req.user.id && !(await teams.adminMayView(req.user, meta, `${sid}/${name}`))) return res.status(404).end();
  const base = name.replace(/\.\w+$/, "");
  const shotFor = async () => (await shoots.get(sid))?.shots.find((s) => s.file === `${sid}/${name}`);
  // A free preview's files get the watermark until the account buys
  // (lib/preview.js): every file of the shoot except its selfies, including
  // the cached squares and sizes (<base>-sq.jpg, -li.jpg…) and the widened
  // square, whatever name they're asked for by. Only a headshot bought on its
  // own ("Keep your pick") is served clean. Not cached for long, so the clean
  // copy shows as soon as they buy.
  const owner = meta.preview ? (meta.userId === req.user.id ? req.user : await users.byId(meta.userId)) : null;
  let preview = false;
  if (isPreview(meta, owner)) {
    const full = await shoots.get(sid);
    const path = `${sid}/${name}`;
    if (!(full?.selfies || []).some((p) => p.file === path)) {
      const stem = base.replace(/-(sq|li|banner|sig)$/, "");
      const shot = full?.shots.find((t) => t.file === path || t.square === path || (derived && t.file?.replace(/\.\w+$/, "") === `${sid}/${stem}`));
      preview = !shot || !isKept(owner, sid, shot.id);
    }
  }
  const send = async (buf, type, filename, cache) => {
    if (preview) {
      // The same preview is asked for on every view; keep the last few.
      const key = `${sid}/${name}|${req.query.square ? "sq" : ""}|${req.query.size || ""}|${buf.length}`;
      buf = previewCache.get(key) || (await watermark(buf, { png: type === "image/png", band: req.query.size !== "signature" }));
      previewCache.delete(key);
      previewCache.set(key, buf);
      if (previewCache.size > 60) previewCache.delete(previewCache.keys().next().value);
      res.set("Cache-Control", "private, no-cache");
      filename = filename?.replace(/^headshot-/, "headshot-preview-");
    } else res.set("Cache-Control", cache);
    res.type(type);
    if (req.query.download) {
      res.attachment(filename);
      if (meta.userId === req.user.id && !meta.downloadedAt) background(shoots.updateMeta(sid, (m) => (m.downloadedAt ? false : ((m.downloadedAt = new Date().toISOString()), m))).catch(() => {}));
    }
    res.send(buf);
  };
  if (req.query.square) {
    // 1:1 square for LinkedIn / Microsoft Teams profile photos (see squareCrop).
    const sq = await squareOf(sid, name, await shotFor());
    if (!sq) return res.status(404).end();
    // Revalidate: a widened square can replace the crop shortly after a frame finishes.
    return send(sq, "image/jpeg", `headshot-${base}-square.jpg`, "private, no-cache");
  }
  if (req.query.size) {
    const spec = SIZES[req.query.size];
    if (!spec) return res.status(404).end();
    const key = `${sid}/${base}-${spec.suffix}`;
    let buf = await readMedia(key);
    if (!buf) {
      buf = await makeSize(req.query.size, sid, name, await shotFor());
      if (!buf) return res.status(404).end();
      await writeMedia(key, buf);
    }
    return send(buf, spec.type, `headshot-${base}-${spec.label}.${spec.suffix.split(".").pop()}`, "private, no-cache");
  }
  const buf = await readMedia(`${sid}/${name}`);
  if (!buf) return res.status(404).end();
  // A preview's clean headshot can go back to the watermark (a refunded keep
  // or package), so it's cached for an hour rather than a year.
  const revertible = meta.preview && !(meta.selfies || []).some((p) => p.file === `${sid}/${name}`);
  return send(buf, name.endsWith(".png") ? "image/png" : "image/jpeg", `headshot-${base}.${name.split(".").pop()}`, revertible ? "private, max-age=3600" : "private, max-age=31536000, immutable");
});

/* ----------------------------- Examples ----------------------------- */

// Marketing example headshots (see lib/examples.js).
// /examples/<id>.jpg is the original; /examples/<id>.webp?w=180|300|360|600|900 is a
// resized WebP for the pages. Either way the CDN caches the response.
const EXAMPLE_WIDTHS = [180, 300, 360, 600, 900];
app.get(/^\/examples\/([a-z0-9-]+)\.(jpg|webp)$/, async (req, res) => {
  const [id, ext] = [req.params[0], req.params[1]];
  // Each distinct URL misses the CDN cache and costs a storage read and a
  // resize, so anything but the canonical query (w, then v) is redirected to
  // it before doing any work.
  const w = EXAMPLE_WIDTHS.includes(Number(req.query.w)) ? Number(req.query.w) : 600;
  const v = /^\w{1,12}$/.test(String(req.query.v || "")) ? String(req.query.v) : "";
  const query = new URLSearchParams({ ...(ext === "webp" ? { w: String(w) } : {}), ...(v ? { v } : {}) }).toString();
  const asked = req.originalUrl.split("?")[1] || "";
  if (asked !== query) return res.redirect(301, `/examples/${id}.${ext}${query ? `?${query}` : ""}`);
  const buf = await exampleImage(id);
  if (!buf) return res.status(404).end();
  // A versioned URL (?v=, bumped whenever an example is replaced; see the
  // README) never changes, so browsers keep it for a year; others for a day.
  res.set("Cache-Control", v ? "public, max-age=31536000, immutable" : "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400");
  if (ext === "jpg") return res.type("image/jpeg").send(buf);
  const out = await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer();
  res.type("image/webp").send(out);
});

// Customer results (lib/showcase.js): offered by customers, shown on the home
// page only once an owner approves them.
const isOwner = (u) => !!u && planFor(u).tier === "owner";
app.get("/api/showcase", async (req, res) => {
  res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  res.json({ entries: await showcase.approved() });
});
app.get(/^\/showcase\/(shc_[\w-]{10,30})\.webp$/, async (req, res) => {
  const e = await showcase.get(req.params[0]);
  const shown = e?.status === "approved";
  // Anything not yet approved is only visible to an owner or its own customer.
  const viewer = shown ? null : await currentUser(req);
  if (!e || (!shown && !isOwner(viewer) && viewer?.id !== e.userId)) return res.status(404).end();
  const buf = await showcase.image(e.id);
  if (!buf) return res.status(404).end();
  const w = [360, 600].includes(Number(req.query.w)) ? Number(req.query.w) : 360;
  // Short CDN lifetime, so a customer taking theirs down is honoured quickly.
  res.set("Cache-Control", shown ? "public, max-age=300, s-maxage=600" : "private, no-store");
  res.type("image/webp").send(await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
});
app.get("/api/showcase/mine", requireUser, async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ entry: showcase.ownEntry(await showcase.forUser(req.user.id)) });
});
app.post("/api/showcase", requireUser, async (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: DEMO_READ_ONLY, code: "demo_read_only" });
  if (req.body?.consent !== true) return res.status(400).json({ error: "Tick the box to give your permission.", fields: { consent: "Tick the box to give your permission." } });
  if (await overLimit("showcase", req.user.id, 10)) return res.status(429).json({ error: "Too many attempts. Please wait a little and try again." });
  req.params.id = String(req.body?.shootId || "");
  const shoot = await ownShoot(req, res);
  if (!shoot) return;
  if (shoot.sample) return res.status(400).json({ error: "Sample shoots can't be shared." });
  // A preview's headshot can be shared once it's bought on its own ("Keep your pick").
  if (isPreview(shoot, req.user) && !isKept(req.user, shoot.id, String(req.body?.shotId || ""))) return res.status(402).json({ error: "Keep this headshot first to share it from your free preview.", code: "preview" });
  try {
    const { entry, first } = await showcase.submit(req.user, shoot, String(req.body?.shotId || ""), req.body || {});
    console.log("[showcase] offered", entry.id, req.user.id);
    if (first && mailEnabled()) {
      sendMail({
        from: { name: "Keeper Headshots website", address: MAIL_FROM },
        to: CONTACT_TO,
        subject: `[Customer results] ${entry.name} offered a headshot`,
        text: [`${entry.name}${entry.role ? `, ${entry.role}` : ""} offered a headshot for the home page.`, entry.quote ? `\n"${entry.quote}"` : "", `\nReview it: ${appOrigin(req)}/app/showcase`].join("\n"),
      }).catch((err) => console.error("[showcase] notify", err.message));
    }
    res.json({ entry: showcase.ownEntry(entry) });
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message, ...(err.field ? { fields: { [err.field]: err.message } } : {}) });
  }
});
app.delete("/api/showcase/mine", requireUser, async (req, res) => {
  await showcase.removeForUser(req.user.id);
  console.log("[showcase] withdrawn", req.user.id);
  res.json({ ok: true });
});
app.get("/api/owner/showcase", requireUser, async (req, res) => {
  if (!isOwner(req.user)) return res.status(404).json({ error: "Not found" });
  res.set("Cache-Control", "no-store");
  const entries = await showcase.forOwner();
  const owners = await Promise.all(entries.map((e) => users.byId(e.userId).catch(() => null)));
  res.json({ entries: entries.map((e, i) => ({ ...showcase.ownEntry(e), decidedAt: e.decidedAt, email: owners[i]?.email || null })) });
});
app.post("/api/owner/showcase/:id", requireUser, async (req, res) => {
  if (!isOwner(req.user)) return res.status(404).json({ error: "Not found" });
  if (req.body?.remove === true) return res.json({ ok: await showcase.remove(req.params.id) });
  const e = await showcase.decide(req.params.id, String(req.body?.status || ""));
  if (!e) return res.status(404).json({ error: "That entry is gone." });
  console.log("[showcase]", e.status, e.id);
  res.json({ entry: showcase.ownEntry(e) });
});

// Social preview images for the landing pages (lib/og.js).
app.get(/^\/og\/([a-z-]+)\.png$/, async (req, res) => {
  const og = await ogImage(req.params[0]);
  if (!og) return res.status(404).end();
  // A preview with a missing example is retried soon rather than kept a week.
  res.set("Cache-Control", og.complete ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" : "public, max-age=300, s-maxage=300");
  res.type("image/png").send(og.buf);
});

// The sign-up funnel (lib/stats.js), for owner accounts (OWNER_EMAILS) only.
app.get("/api/owner/funnel", requireUser, async (req, res) => {
  if (planFor(req.user).tier !== "owner") return res.status(404).json({ error: "Not found" });
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.set("Cache-Control", "no-store");
  res.json(await funnelReport(days));
});

// Owner: recent customer shoots and how each went (lib/outreach.js).
app.get("/api/owner/shoots", requireUser, async (req, res) => {
  if (!isOwner(req.user)) return res.status(404).json({ error: "Not found" });
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.set("Cache-Control", "no-store");
  res.json(await reviewShoots(days));
});

// Owner: a one-time follow-up email with a Stripe promotion code. POST with
// send: false only counts who'd get it.
app.post("/api/owner/offer", requireUser, async (req, res) => {
  if (!isOwner(req.user)) return res.status(404).json({ error: "Not found" });
  const code = String(req.body?.code || "").trim().toUpperCase();
  const discount = String(req.body?.discount || "").trim().slice(0, 40);
  const until = String(req.body?.until || "").trim().slice(0, 40);
  const report = await sendOffer({ code, discount, until, origin: appOrigin(req), dryRun: req.body?.send !== true });
  if (req.body?.send === true) console.log("[offer]", code, JSON.stringify(report));
  res.json(report);
});

// Owner-only generator, enabled only while ADMIN_TOKEN is set.
function adminOnly(req, res, next) {
  const want = process.env.ADMIN_TOKEN || "";
  // Header only: a token in the query string would end up in request logs.
  const got = String(req.get("x-admin-token") || "");
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

/* -------------------------------- Cron ------------------------------ */

// Daily jobs (vercel.json "crons"). Vercel sends
// "Authorization: Bearer $CRON_SECRET"; without CRON_SECRET the routes are off.
function cronOnly(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const got = String(req.get("authorization") || "");
  const want = `Bearer ${secret}`;
  const digest = (v) => crypto.createHash("sha256").update(v).digest();
  if (!secret || secret.length < 24 || !crypto.timingSafeEqual(digest(got), digest(want))) return res.status(404).json({ error: "Not found" });
  next();
}

// Storage clean-up (lib/cleanup.js).
app.get("/api/cron/cleanup", cronOnly, async (req, res) => {
  const report = await runCleanup({ budgetMs: 180_000 });
  console.log("[cleanup]", JSON.stringify(report));
  // Then the day's reminder emails (lib/reminders.js), resuming where the
  // last run stopped. A problem here never undoes the clean-up.
  const state = (await getJSON(REMINDER_STATE).catch(() => null)) || {};
  report.reminders = await runReminders({ origin: appOrigin(req), deadline: Date.now() + 60_000, state }).catch((err) => (console.error("[reminders]", err.message), { error: err.message }));
  await putJSON(REMINDER_STATE, state).catch((err) => console.error("[reminders] state", err.message));
  console.log("[reminders]", JSON.stringify(report.reminders));
  res.json(report);
});

// Unsubscribing from reminder emails. The email's footer link opens
// /unsubscribe (which posts here); mail apps' one-click unsubscribe
// (List-Unsubscribe-Post, RFC 8058) posts here directly, form-encoded.
const REMINDER_STATE = "cron/reminders-state.json";
app.post("/api/unsubscribe", express.urlencoded({ extended: false, limit: "2kb" }), async (req, res) => {
  const uid = checkUnsubscribeToken(req.query.token || req.body?.token);
  if (!uid) return res.status(400).json({ error: "This unsubscribe link isn't valid. You can turn reminders off on your account page." });
  const user = await users.update(uid, (u) => {
    if (u.remindersOff) return UNCHANGED;
    u.remindersOff = new Date().toISOString();
  }).catch(() => null);
  if (!user) return res.status(404).json({ error: "We couldn't find that account. It may have been deleted." });
  console.log("[reminders] unsubscribed", uid);
  res.json({ ok: true });
});

// Nightly backup of accounts, payments and shoot records (lib/backup.js).
// Every minute: unfinished shoots keep developing with no page open
// (lib/shoot-jobs.js). Quiet when there's nothing to do.
app.get("/api/cron/shoots", cronOnly, async (req, res) => {
  const report = await runDueShootJobs();
  if (report.jobs) console.log("[shoot-cron]", JSON.stringify(report));
  res.json(report);
});

app.get("/api/cron/backup", cronOnly, async (req, res) => {
  const report = await runBackup();
  console.log("[backup]", JSON.stringify(report));
  res.json(report);
});

// The blog's articles from Soro's feed (lib/blog.js). The site also reads the
// feed when someone opens the blog and the copy is an hour old.
app.get("/api/cron/blog", cronOnly, async (req, res) => {
  const report = await syncBlog();
  console.log("[blog] cron", JSON.stringify(report));
  res.json(report);
});

/* ------------------------------- Static ----------------------------- */

// Scripts are addressed by version, /v/<build>/js/... (lib/seo.js). The
// folder only changes when the code does, so browsers keep them for a year.
// (On Vercel the CDN serves these through a rewrite in vercel.json; this is
// for local runs, and a fallback.)
app.use((req, res, next) => {
  const m = /^\/v\/[\w-]{1,40}(\/js\/.*)$/.exec(req.path);
  if (!m) return next();
  req.url = m[1];
  if (process.env.NODE_ENV === "production") res.set("Cache-Control", "public, max-age=31536000, immutable");
  express.static(path.join(__dirname, "public"), { fallthrough: false, cacheControl: process.env.NODE_ENV !== "production", maxAge: 0 })(req, res, next);
});

// On Vercel, files in public/ are served by the CDN before reaching Express.
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use("/media", (req, res) => res.status(404).end());
// SPA fallback for client routes.
// Every other GET is the single-page app. lib/seo.js gives each path its own
// title, description, canonical URL and robots rule (plus prerendered content
// for public pages), and unknown paths a real 404 status.
// Content Security Policy for pages. Scripts come from our origin plus
// Turnstile (sign-up, contact), the Meta pixel and Stripe.js (embedded checkout); styles allow inline for
// the style="" attributes the views use.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://connect.facebook.net https://js.stripe.com https://*.js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://www.facebook.com https://*.stripe.com",
  // Exact primary/fallback hosts in Pixel 1088231967271424's Meta openbridge
  // configuration. Keep cloud-provider wildcards out of this policy.
  "connect-src 'self' https://www.facebook.com https://connect.facebook.net https://api.stripe.com https://*.stripe.com https://xd-f1cf3d4fdb19408ea770fc6f80817dcb.ecs.us-east-1.on.aws https://bded8a3c6ae-1-1053047382554.us-central1.run.app",
  // www.facebook.com: the Meta Pixel's fallback when its normal send is
  // blocked (a hidden frame that posts the event there).
  "frame-src https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://hooks.stripe.com https://www.facebook.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://www.facebook.com",
  "frame-ancestors 'none'",
].join("; ");
// The blog's articles come from Soro (views/blog.js): its script, the data it
// fetches and the images and styles it shows are allowed on /blog pages only.
const SORO = "https://app.trysoro.com https://*.trysoro.com";
const BLOG_CSP = CSP.replace("script-src 'self'", `script-src 'self' ${SORO}`)
  .replace("style-src 'self'", `style-src 'self' ${SORO}`)
  .replace("font-src 'self'", `font-src 'self' ${SORO}`)
  .replace("img-src 'self' data: blob:", "img-src 'self' data: blob: https:")
  .replace("connect-src 'self'", `connect-src 'self' ${SORO}`)
  .replace("frame-src ", `frame-src ${SORO} `);

// The blog's images (copies of Soro's, lib/blog.js). The name is a hash of
// the original address, so a file never changes.
app.get("/blog/img/:name", async (req, res) => {
  const buf = await blogImage(req.params.name).catch(() => null);
  if (!buf) return res.status(404).end();
  // s-maxage: Vercel's CDN keeps a copy too (max-age alone is only for browsers).
  res.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable").type(req.params.name.endsWith(".webp") ? "image/webp" : "image/jpeg").send(buf);
});
// The articles' own sitemap (robots.txt lists it next to /sitemap.xml).
app.get("/blog/sitemap.xml", async (req, res) => {
  const index = await blogIndex().catch(() => null);
  res.set("Cache-Control", "public, max-age=0, s-maxage=3600").type("application/xml").send(blogSitemap(index));
});

// The blog served from Soro's feed: /blog lists the articles, /blog/<slug>
// is one, and the embed's old addresses (/blog?post=<slug>) move there.
// Returns false when the blog isn't served from the feed (views/blog.js
// shows Soro's embed instead).
async function serveBlog(req, res, clean) {
  if (clean !== "/blog" && !clean.startsWith("/blog/")) return false;
  const index = await blogIndex().catch((err) => (console.error("[blog]", err.message), null));
  if (!index) return false;
  res.set("Content-Security-Policy", CSP);
  if (!isCanonicalHost(req.get("host"))) res.set("X-Robots-Tag", "noindex");
  const notFound = () => res.status(404).type("html").send(blogNotFoundPage(index).html);
  if (clean === "/blog") {
    const post = req.query.post;
    if (typeof post !== "string") res.status(200).type("html").send(blogIndexPage(index).html);
    else if (index.posts.some((p) => p.slug === post.toLowerCase())) res.redirect(301, `/blog/${post.toLowerCase()}`);
    else notFound();
    return true;
  }
  const slug = clean.slice("/blog/".length);
  const post = await blogPost(slug);
  if (post) res.status(200).type("html").send(blogArticlePage(post, index).html);
  else if (slug !== slug.toLowerCase() && index.posts.some((p) => p.slug === slug.toLowerCase())) res.redirect(301, `/blog/${slug.toLowerCase()}`);
  else notFound();
  return true;
}

const EMPTY_CUSTOMERS = /<section class="section" id="customers"[^>]*>\s*<\/section>/;
async function withCustomers(html) {
  if (!EMPTY_CUSTOMERS.test(html)) return html;
  const entries = await showcase.approved().catch(() => []);
  // A function, not a string: "$`" or "$'" in a customer's words must not be
  // read as a replacement pattern (which would paste the page into itself).
  return entries.length ? html.replace(EMPTY_CUSTOMERS, () => customersSection(entries)) : html;
}

// Public pages are the same for everyone (accounts load in the browser), so
// Vercel's CDN may serve them for a minute and refresh in the background:
// visitors (and bots probing for WordPress) rarely wait on a cold function.
// Browsers still revalidate every time; each deploy clears the CDN.
const PAGE_CDN_CACHE = "max-age=60, stale-while-revalidate=86400";
app.get(/.*/, async (req, res) => {
  res.set("Vercel-CDN-Cache-Control", PAGE_CDN_CACHE);
  res.set("Content-Security-Policy", /^\/blog(\/|$)/.test(req.path) ? BLOG_CSP : CSP);
  // "//evil.com/" or "/\\evil.com" must never become a redirect to another site.
  if (/^\/[\/\\]/.test(req.path) || req.path.includes("\\")) return res.status(404).type("html").send(pageFor("/__not_found__").html);
  const clean = req.path.length > 1 ? "/" + req.path.replace(/\/+$/, "").replace(/^\/+/, "") : "/";
  if (clean !== req.path) return res.redirect(301, clean + req.url.slice(req.path.length));
  // Guessed addresses for sections of the home page.
  if (clean === "/pricing" || clean === "/faq") return res.redirect(308, `/#${clean.slice(1)}`);
  if (await serveBlog(req, res, clean)) return;
  // A blog article (/blog?post=<slug>) is its own page to search engines.
  const post = clean === "/blog" && typeof req.query.post === "string" ? blogPostPage(req.query.post) : null;
  let { status, html } = post || pageFor(clean);
  // The home page carries the approved customer headshots in its HTML, so
  // search engines see them (the browser fills the same section in later).
  if (clean === "/") html = await withCustomers(html);
  if (!isCanonicalHost(req.get("host"))) res.set("X-Robots-Tag", "noindex");
  res.status(status).type("html").send(html);
});

app.use((err, req, res, next) => {
  if (err instanceof PlanError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.type === "StripeInvalidRequestError" && err.statusCode === 404) return res.status(404).json({ error: "We couldn't find that checkout." });
  if (err?.type?.startsWith?.("Stripe")) {
    console.error("[stripe]", err.type, err.message);
    return res.status(502).json({ error: "The payment provider couldn't complete that request. Please try again." });
  }
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "That photo is too large. Try a smaller one." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "That request couldn't be read. Please try again." });
  if (err?.status && err.status < 500 && !(err instanceof AIError)) return res.status(err.status).json({ error: err.message });
  // Storage busy (lib/storage.js gives up after repeated write conflicts): a
  // retryable 503 with its own message, not a generic 500.
  if (err?.status === 503 && !(err instanceof AIError)) {
    console.warn("[503]", req.method, req.path, err.message);
    return res.status(503).json({ error: err.message });
  }
  const status = err instanceof AIError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 500 && !(err instanceof AIError) ? "Something went wrong on our side. Please try again." : err.message });
});

export default app;

if (!process.env.VERCEL) {
  await seed();
  startLocalShootWorker();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    const s = aiStatus();
    console.log(`Keeper Headshots running at http://localhost:${port} (storage: ${backend})`);
    console.log(`  Claude (${s.visionModel}): ${s.vision ? "ready" : "missing ANTHROPIC_API_KEY"}`);
    console.log(`  Gemini (${s.imageModel}): ${s.imaging ? "ready" : "missing GEMINI_API_KEY"}`);
  });
}
