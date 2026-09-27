// Password hashing (scrypt) and stateless signed-cookie sessions.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { users } from "./store.js";
import { planFor } from "./plan.js";
import { photoFormat } from "../public/js/shared/catalog.js";

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

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("base64url");
}

export function setSession(res, userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE_MS })).toString("base64url");
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

export async function currentUser(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > exp) return null;
    return (await users.byId(uid)) || null;
  } catch {
    return null;
  }
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
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, demo: !!u.demo, emailVerified: emailVerified(u), photoFormat: photoFormat(u.photoFormat), plan: planFor(u) });
