// Password hashing (scrypt) and stateless signed-cookie sessions.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, users } from "./store.js";

const SECRET_FILE = path.join(DATA_DIR, ".session-secret");
const SECRET =
  process.env.SESSION_SECRET ||
  (fs.existsSync(SECRET_FILE)
    ? fs.readFileSync(SECRET_FILE, "utf8")
    : (() => {
        const s = crypto.randomBytes(32).toString("hex");
        fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
        return s;
      })());

const COOKIE = "hp_session";
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
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

export function currentUser(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > exp) return null;
    return users.byId(uid) || null;
  } catch {
    return null;
  }
}

export function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Please sign in to continue." });
  req.user = user;
  next();
}

export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, demo: !!u.demo });
