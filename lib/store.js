// Data model on top of lib/storage.js. Layout:
//   users/id/<uid>.json            user record
//   users/email/<sha256>.json      { id } lookup by email
//   idx/<uid>/<sid>                one marker per shoot (for listing)
//   shoots/<sid>.json              shoot "meta": selfies, check, plan, review
//   shots/<sid>/<shotId>.json      one record per rendered frame
//   media/<sid>/<name>.jpg         images
// Each frame writes only its own record, so parallel renders never race on
// the shoot document.

import crypto from "node:crypto";
import * as storage from "./storage.js";

export const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
const emailKey = (email) => `users/email/${crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex")}.json`;

export const users = {
  async byEmail(email) {
    const ref = await storage.getJSON(emailKey(email));
    return ref ? this.byId(ref.id) : null;
  },
  byId: (uid) => (uid ? storage.getJSON(`users/id/${uid}.json`) : null),
  async create(user) {
    await storage.putJSON(`users/id/${user.id}.json`, user);
    await storage.putJSON(emailKey(user.email), { id: user.id });
    return user;
  },
};

const SHOT_RUNTIME = ["status", "file", "error", "startedAt", "finishedAt"];

function merge(meta, docs) {
  const byId = new Map(docs.filter(Boolean).map((d) => [d.id, d]));
  return {
    ...meta,
    shots: (meta.shots || []).map((plan) => {
      const doc = byId.get(plan.id);
      return { ...plan, status: "pending", file: null, error: null, ...(doc ? Object.fromEntries(SHOT_RUNTIME.map((k) => [k, doc[k] ?? null])) : {}) };
    }),
  };
}

export const shoots = {
  getMeta: (sid) => storage.getJSON(`shoots/${sid}.json`),
  async get(sid) {
    const meta = await this.getMeta(sid);
    if (!meta) return null;
    const docs = await Promise.all((meta.shots || []).map((s) => storage.getJSON(`shots/${sid}/${s.id}.json`)));
    return merge(meta, docs);
  },
  async saveMeta(meta) {
    meta.updatedAt = new Date().toISOString();
    // Only the plan is stored on the meta; runtime state lives in shot records.
    const clean = { ...meta, shots: (meta.shots || []).map(({ id, lookId, backdrop, outfit, take }) => ({ id, lookId, backdrop, outfit, take })) };
    await storage.putJSON(`shoots/${meta.id}.json`, clean);
    return meta;
  },
  saveShot: (sid, shot) => storage.putJSON(`shots/${sid}/${shot.id}.json`, { ...shot, updatedAt: new Date().toISOString() }),
  async clearShots(sid) {
    await storage.del(await storage.list(`shots/${sid}/`));
  },
  async create(meta) {
    await this.saveMeta(meta);
    await storage.putJSON(`idx/${meta.userId}/${meta.id}`, { createdAt: meta.createdAt });
    return meta;
  },
  async forUser(uid) {
    const keys = await storage.list(`idx/${uid}/`);
    const metas = await Promise.all(keys.map((k) => this.getMeta(k.split("/").pop())));
    return metas.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async remove(meta) {
    const media = await storage.list(`media/${meta.id}/`);
    const shots = await storage.list(`shots/${meta.id}/`);
    await storage.del([...media, ...shots, `shoots/${meta.id}.json`, `idx/${meta.userId}/${meta.id}`]);
  },
};

export async function saveMedia(sid, buffer, ext = "jpg") {
  const file = `${sid}/${crypto.randomBytes(12).toString("base64url")}.${ext}`;
  await storage.putFile(`media/${file}`, buffer, ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg");
  return file;
}

export const readMedia = (file) => storage.getFile(`media/${file}`);
export const deleteMedia = (file) => storage.del(`media/${file}`);
