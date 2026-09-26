// Tiny JSON-file store. Good enough for a single-process app; every write is
// atomic (write to temp file, then rename) so a crash never corrupts data.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(MEDIA_DIR, { recursive: true });

let db = { users: [], shoots: [] };
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

let pending = null;
function persist() {
  // Coalesce bursts of writes (e.g. several shots finishing together).
  if (pending) return;
  pending = setImmediate(() => {
    pending = null;
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  });
}

export const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;

export const users = {
  byEmail: (email) => db.users.find((u) => u.email === email.toLowerCase().trim()),
  byId: (uid) => db.users.find((u) => u.id === uid),
  create(user) {
    db.users.push(user);
    persist();
    return user;
  },
};

export const shoots = {
  all: () => db.shoots,
  forUser: (uid) =>
    db.shoots.filter((s) => s.userId === uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  byId: (sid) => db.shoots.find((s) => s.id === sid),
  create(shoot) {
    db.shoots.push(shoot);
    persist();
    return shoot;
  },
  update(sid, fn) {
    const s = db.shoots.find((x) => x.id === sid);
    if (!s) return null;
    fn(s);
    s.updatedAt = new Date().toISOString();
    persist();
    return s;
  },
  remove(sid) {
    const s = db.shoots.find((x) => x.id === sid);
    db.shoots = db.shoots.filter((x) => x.id !== sid);
    persist();
    return s;
  },
};

export function saveMedia(buffer, ext) {
  const name = `${crypto.randomBytes(12).toString("base64url")}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), buffer);
  return name;
}

export function readMedia(name) {
  return fs.readFileSync(path.join(MEDIA_DIR, path.basename(name)));
}

export function isEmpty() {
  return db.users.length === 0;
}
