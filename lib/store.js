// Data model on top of lib/storage.js. Layout:
//   users/id/<uid>.json            user record
//   users/email/<sha256>.json      { id } lookup by email
//   users/deleted/<sha256>.json    free-plan usage of a deleted account
//   idx/<uid>/<sid>                one marker per shoot (for listing)
//   shoots/<sid>.json              shoot "meta": selfies, check, plan, review
//   shots/<sid>/<shotId>.json      one record per rendered frame
//   media/<sid>/<name>.jpg         images
// Each frame writes only its own record, so parallel renders never race on
// the shoot document.

import crypto from "node:crypto";
import * as storage from "./storage.js";

export const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
const emailHash = (email) => crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
const emailKey = (email) => `users/email/${emailHash(email)}.json`;
const deletedKey = (email) => `users/deleted/${emailHash(email)}.json`;

// One inbox, one free shoot: "Jo.Smith+x@gmail.com" and "josmith@gmail.com"
// are the same mailbox, so the free-shoot claim is keyed on this form.
export function canonicalEmail(email) {
  let [local = "", domain = ""] = String(email).toLowerCase().trim().split("@");
  local = local.split("+")[0];
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}
export const freeClaimKey = (email) => `claims/free/${emailHash(canonicalEmail(email))}.json`;

export const users = {
  async byEmail(email) {
    const ref = await storage.getJSON(emailKey(email));
    return ref ? this.byId(ref.id) : null;
  },
  byId: (uid) => (uid ? storage.getJSON(`users/id/${uid}.json`) : null),
  // Atomic: concurrent updates (a purchase landing while a shoot is charged,
  // two tabs) can't overwrite each other. fn mutates the user and may run more
  // than once; it may throw to abort without saving.
  update: (uid, fn) => (uid ? storage.updateJSON(`users/id/${uid}.json`, (u) => (fn(u), u)) : null),
  async create(user) {
    // Re-creating a deleted account doesn't hand out a second free shoot.
    const prior = await storage.getJSON(deletedKey(user.email));
    if (prior?.usage) user.usage = { ...prior.usage, ...user.usage };
    await storage.putJSON(`users/id/${user.id}.json`, user);
    await storage.putJSON(emailKey(user.email), { id: user.id });
    return user;
  },
  // Delete the account and every shoot, selfie and headshot in it. The only
  // thing kept is the free-plan usage under a hash of the email (see the
  // privacy policy); payment records live under payments/ for accounting.
  async remove(user) {
    for (const meta of await shoots.forUser(user.id)) await shoots.remove(meta);
    await storage.del(await storage.list(`idx/${user.id}/`));
    const usage = user.usage || {};
    if (usage.freeShootUsed || usage.checks) {
      await storage.putJSON(deletedKey(user.email), { usage: { freeShootUsed: !!usage.freeShootUsed, checks: usage.checks || 0 }, deletedAt: new Date().toISOString() });
    }
    await storage.del([emailKey(user.email), `users/id/${user.id}.json`]);
  },
};

const SHOT_RUNTIME = ["status", "file", "error", "startedAt", "finishedAt", "stage", "attempt", "qa", "square"];

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
  // Atomic read-modify-write of the meta (see storage.updateJSON). fn gets the
  // stored meta (plan only, no runtime shot state) and returns it, or returns
  // false to leave it unchanged.
  updateMeta: (sid, fn) =>
    storage.updateJSON(`shoots/${sid}.json`, (m) => {
      const out = fn(m);
      if (out === false) return storage.UNCHANGED;
      return { ...m, updatedAt: new Date().toISOString(), shots: (m.shots || []).map(({ id, lookId, backdrop, outfit, take }) => ({ id, lookId, backdrop, outfit, take })) };
    }),
  saveShot: (sid, shot) => storage.putJSON(`shots/${sid}/${shot.id}.json`, { ...shot, updatedAt: new Date().toISOString() }),

  // Rendering a frame is claimed atomically, so two server instances polling
  // the same shoot can't both render it. The winner's claim token is stored on
  // the frame, and every later write by that worker must present it
  // (writeShot), so a worker that lost its claim (timed out and retried) can't
  // overwrite the newer attempt.
  //
  // claimShot: pending -> rendering. True only for the one caller that won.
  async claimShot(sid, shotId, claim, startedAt) {
    const key = `shots/${sid}/${shotId}.json`;
    const doc = { id: shotId, status: "rendering", file: null, error: null, startedAt, claim, updatedAt: startedAt };
    // No record yet (a frame that has never been attempted): create-if-absent.
    if (await storage.createJSON(key, doc)) return true;
    let won = false;
    await storage.updateJSON(key, (d) => {
      won = d.status === "pending";
      return won ? doc : storage.UNCHANGED;
    });
    return won;
  },
  // Writes fields to a frame only while `claim` still owns it. Returns false
  // if the claim was lost (or the frame was cleared).
  async writeShot(sid, shotId, claim, fields) {
    let owned = false;
    await storage.updateJSON(`shots/${sid}/${shotId}.json`, (d) => {
      owned = d.claim === claim;
      return owned ? { ...d, ...fields, id: shotId, claim, updatedAt: new Date().toISOString() } : storage.UNCHANGED;
    });
    return owned;
  },
  // Conditional update: fn gets the stored frame and returns true to save
  // its changes. Returns whether it saved.
  async updateShot(sid, shotId, fn) {
    let saved = false;
    await storage.updateJSON(`shots/${sid}/${shotId}.json`, (d) => {
      saved = fn(d) === true;
      return saved ? { ...d, updatedAt: new Date().toISOString() } : storage.UNCHANGED;
    });
    return saved;
  },
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
export const writeMedia = (file, buffer) => storage.putFile(`media/${file}`, buffer, "image/jpeg");
export const deleteMedia = (file) => storage.del(`media/${file}`);
