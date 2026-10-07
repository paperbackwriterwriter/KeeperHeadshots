// Password hashing (scrypt) and stateless signed-cookie sessions.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { users } from "./store.js";
import { UNCHANGED } from "./storage.js";
import { planFor } from "./plan.js";
import { photoFormat } from "../public/js/shared/catalog.js";
import { hasBought, unlocksPreviews } from "./preview.js";

// On Vercel the secret must come from the environment (the disk is ephemeral);
// locally a random one is generated once and kept in ./data.
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.VERCEL) throw new Error("SESSION_SECRET must be set on Vercel.");
  const dir = path.resolve(process.env.DATA_DIR || "data");
  const file = path.join(dir, ".session-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  fs.mkdirSync(dir, { recursive: true });
  const s = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

const COOKIE = "ahg_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

// Async so hashing doesn't block other requests on the same instance.
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));
  return `${salt}:${hash.toString("hex")}`;
}

// Async so a burst of sign-ins doesn't block the event loop.
export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));
  const want = Buffer.from(hash, "hex");
  return want.length === test.length && crypto.timingSafeEqual(test, want);
}

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("base64url");
}

// Sessions carry the user's session version ("sv"); bumping it (password
// reset, "sign out everywhere") invalidates every cookie issued before. Each
// sign-in also gets its own id ("sid"), so signing out can revoke just that
// one session (a copy of the cookie stops working too) without signing out
// the person's other devices.
export function setSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ uid: user.id, sv: user.sessionVersion || 0, sid: crypto.randomBytes(12).toString("base64url"), exp: Date.now() + MAX_AGE_MS })).toString("base64url");
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || !!process.env.VERCEL,
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

// Email confirmation links: "<uid>.<expiry>.<signature>". The signature also
// covers the email address, so a link stops working if the address changes.
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24 * 3;
const verifySig = (uid, exp, email) => sign(`verify:${uid}:${exp}:${email}`);

export function emailToken(user) {
  const exp = Date.now() + VERIFY_TTL_MS;
  return `${user.id}.${exp}.${verifySig(user.id, exp, user.email)}`;
}

// The same email also carries a 6-digit code, typed on the page the person is
// already signed in on. It confirms the address only for the account that's
// signed in (unlike the link, which works from any browser), so someone who
// signed up inside Facebook's or Instagram's in-app browser can confirm
// without losing their session. Derived from the day it was sent, so no state
// is stored; valid for 3 to 4 days (the day it was sent and the three after). Guessing is limited by the
// caller (a few tries an hour).
const DAY_MS = 24 * 60 * 60 * 1000;
const codeFor = (user, day) =>
  String(crypto.createHmac("sha256", SECRET).update(`verifycode:${user.id}:${user.email}:${day}`).digest().readUInt32BE(0) % 1_000_000).padStart(6, "0");
export const emailCode = (user, now = Date.now()) => codeFor(user, Math.floor(now / DAY_MS));
export function checkEmailCode(user, code, now = Date.now()) {
  const c = String(code || "").replace(/\D/g, "");
  if (c.length !== 6) return false;
  const today = Math.floor(now / DAY_MS);
  return [0, 1, 2, 3].some((back) => {
    const expected = codeFor(user, today - back);
    return crypto.timingSafeEqual(Buffer.from(c), Buffer.from(expected));
  });
}

// Returns { user } for a valid link, { user, error: "expired" } for a genuine
// but expired one, or { error: "invalid" }.
export async function checkEmailToken(token) {
  const m = /^(usr_[\w-]+)\.(\d{10,16})\.([\w-]{20,})$/.exec(String(token || ""));
  if (!m) return { error: "invalid" };
  const [, uid, exp, sig] = m;
  const user = await users.byId(uid);
  if (!user) return { error: "invalid" };
  const expected = verifySig(uid, exp, user.email);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return { error: "invalid" };
  if (Date.now() > Number(exp)) return { user, error: "expired" };
  return { user };
}

// Password reset links: "<uid>.<expiry>.<signature>", valid for an hour. The
// signature covers the current password hash, so a link works only once: after
// the password changes (by this link or any other way) it no longer matches.
const RESET_TTL_MS = 1000 * 60 * 60;
const resetSig = (uid, exp, u) => sign(`reset:${uid}:${exp}:${u.email}:${u.password}`);

export function resetToken(user) {
  const exp = Date.now() + RESET_TTL_MS;
  return `${user.id}.${exp}.${resetSig(user.id, exp, user)}`;
}

// Returns { user } for a usable link, or { error: "invalid" | "expired" }.
export async function checkResetToken(token) {
  const m = /^(usr_[\w-]+)\.(\d{10,16})\.([\w-]{20,})$/.exec(String(token || ""));
  if (!m) return { error: "invalid" };
  const [, uid, exp, sig] = m;
  const user = await users.byId(uid);
  if (!user || user.demo) return { error: "invalid" };
  const expected = resetSig(uid, exp, user);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return { error: "invalid" };
  if (Date.now() > Number(exp)) return { error: "expired" };
  return { user };
}

// The verified contents of the session cookie ({ uid, sv, sid, exp }), or null.
export function readSession(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString());
    return Date.now() > s.exp ? null : s;
  } catch {
    return null;
  }
}

export async function currentUser(req) {
  const s = readSession(req);
  if (!s) return null;
  const user = await users.byId(s.uid);
  if (!user || (user.sessionVersion || 0) !== (s.sv || 0)) return null;
  if (s.sid && (user.revokedSessions || []).some((r) => r.sid === s.sid)) return null;
  return user;
}

// Signing out: this session's id is kept on the account until the cookie
// would have expired anyway, so the cookie (or a copy of it) can't be reused.
// The list is capped; past the cap (or for a cookie from before sessions had
// ids) the account's session version moves on instead, which signs out every
// device. The shared demo account is read-only and its password is public, so
// its sessions aren't tracked (a sign-in/out loop would only grow its record).
const MAX_REVOKED = 50;
export async function revokeSession(req) {
  const s = readSession(req);
  if (!s) return;
  const now = Date.now();
  await users.update(s.uid, (u) => {
    if (u.demo || (u.sessionVersion || 0) !== (s.sv || 0)) return UNCHANGED;
    const live = (u.revokedSessions || []).filter((r) => r.exp > now && r.sid !== s.sid);
    if (!s.sid || live.length >= MAX_REVOKED) {
      u.sessionVersion = (u.sessionVersion || 0) + 1;
      u.revokedSessions = [];
    } else {
      u.revokedSessions = [...live, { sid: s.sid, exp: s.exp }];
    }
  });
}

export async function requireUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Please sign in to continue." });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export const emailVerified = (u) => u.emailVerified !== false; // accounts made before confirmation existed count as confirmed
// Proven by the person themselves (the link or code we emailed them). Accepting
// a team invitation also marks an address confirmed, so the team shoot can go
// ahead, but the invite link was handed to the team's admin, so it doesn't
// prove who owns the inbox: that isn't enough for the free shoot, owner access
// or reminder emails (lib/plan.js, lib/reminders.js).
export const ownsMailbox = (u) => emailVerified(u) && u.emailVerifiedVia !== "invite";
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, demo: !!u.demo, emailVerified: emailVerified(u), photoFormat: photoFormat(u.photoFormat), plan: planFor(u), hasTeam: !!u.teamId, emailReminders: !u.remindersOff, purchased: hasBought(u), previewsUnlocked: unlocksPreviews(u), kept: u.kept || {}, extraLooks: Object.fromEntries(Object.entries(u.extraLooks || {}).filter(([, n]) => n > 0)) });
