// Data model on top of lib/storage.js. Layout:
//   users/id/<uid>.json            user record
//   users/email/<sha256>.json      { id } lookup by email
//   users/deleted/<sha256>.json    free-plan usage of a deleted account
//   usage/checks/<sha256>.json     free photo checks used by one mailbox
//   idx/<uid>/<sid>                one marker per shoot (for listing)
//   shoots/<sid>.json              shoot "meta": selfies, check, plan, review
//   shots/<sid>/<shotId>.json      one record per rendered frame
//   media/<sid>/<name>.jpg         images
// Each frame writes only its own record, so parallel renders never race on
// the shoot document.

import crypto from "node:crypto";
import * as storage from "./storage.js";
import { catalogShoot, uncatalogShoot, removeShootCatalog } from "./shoot-list.js";
import { mapLimit } from "./collections.js";
import { purgeUserPhotos, purgeShootPhotos, purgePhoto } from "./photo-backup.js";

// Erasure barriers contain only random IDs and a boolean, with no photos or
// account details. Keep them so an old delivery cannot restore erased data.
const cancelledShootKey = (sid) => `cancelled/shoots/${sid}.json`;
const cancelledUserKey = (uid) => `cancelled/users/${uid}.json`;
export const accountDeleting = async (uid) => !!(uid && await storage.getJSON(cancelledUserKey(uid)));
export async function shootCancelled(sid, uid = null) {
  if (await storage.getJSON(cancelledShootKey(sid))) return true;
  const owner = uid || (await storage.getJSON(`shoots/${sid}.json`))?.userId;
  return accountDeleting(owner);
}
const gone = () => Object.assign(new Error("This shoot or account has been deleted."), { status: 410 });
// Check on both sides of storage I/O. If deletion overlapped a write after
// its prefix was swept, that writer removes its own late object immediately.
async function shootWrite(sid, keys, write, uid = null) {
  if (await shootCancelled(sid, uid)) throw gone();
  const out = await write();
  if (await shootCancelled(sid, uid)) {
    await storage.del(keys);
    throw gone();
  }
  return out;
}
async function userWrite(uid, write) {
  if (await accountDeleting(uid)) throw gone();
  const out = await write();
  if (await accountDeleting(uid)) {
    if ((await storage.getJSON(cancelledUserKey(uid)))?.erased) await storage.del(`users/id/${uid}.json`);
    throw gone();
  }
  return out;
}

export const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
const emailHash = (email) => crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
const emailKey = (email) => `users/email/${emailHash(email)}.json`;
const deletedKey = (email) => `users/deleted/${emailHash(email)}.json`;

// One inbox, one free shoot: "Jo.Smith+x@gmail.com" and "josmith@gmail.com"
// are the same mailbox, so the free-shoot claim is keyed on this form.
export function canonicalEmail(email) {
  let [local = "", domain = ""] = String(email).toLowerCase().trim().split("@");
  // '"jo"@gmail.com' and 'jo@gmail.com.' reach the same inbox as jo@gmail.com.
  local = local.replace(/^"(.*)"$/, "$1").split("+")[0];
  domain = domain.replace(/\.+$/, "");
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}
export const freeClaimKey = (email) => `claims/free/${emailHash(canonicalEmail(email))}.json`;

// The free photo checks are counted per mailbox as well as per account, so
// me+1@… and me+2@… share one allowance (like the free shoot).
const checksKey = (email) => `usage/checks/${emailHash(canonicalEmail(email))}.json`;
export const mailboxChecks = {
  used: async (email) => (await storage.getJSON(checksKey(email)))?.checks || 0,
  // Counts one check if the mailbox has any left. Returns the new total, or
  // null when the allowance is used up. \`seed\` is this account's own count,
  // for mailboxes that checked photos before this record existed.
  async reserve(email, limit, seed = 0) {
    await storage.createJSON(checksKey(email), { checks: seed });
    let total = null;
    await storage.updateJSON(checksKey(email), (r) => {
      const used = Math.max(r.checks || 0, seed);
      total = used < limit ? used + 1 : null;
      return total === null ? storage.UNCHANGED : { ...r, checks: total };
    });
    return total;
  },
  release: (email) => storage.updateJSON(checksKey(email), (r) => ({ ...r, checks: Math.max(0, (r.checks || 0) - 1) })).catch(() => {}),
  // Checks past the free allowance, before the free shoot: counted per mailbox
  // per day (UTC). Returns false when today's are used up.
  async reserveToday(email, limit, date) {
    await storage.createJSON(checksKey(email), { checks: 0 });
    let ok = false;
    await storage.updateJSON(checksKey(email), (r) => {
      const n = r.day?.date === date ? r.day.n : 0;
      ok = n < limit;
      return ok ? { ...r, day: { date, n: n + 1 } } : storage.UNCHANGED;
    });
    return ok;
  },
  releaseToday: (email, date) => storage.updateJSON(checksKey(email), (r) => (r.day?.date === date ? { ...r, day: { date, n: Math.max(0, r.day.n - 1) } } : storage.UNCHANGED)).catch(() => {}),
};

export const users = {
  async byEmail(email) {
    const ref = await storage.getJSON(emailKey(email));
    return ref ? this.byId(ref.id) : null;
  },
  byId: (uid) => (uid ? storage.getJSON(`users/id/${uid}.json`) : null),
  // Atomic: concurrent updates (a purchase landing while a shoot is charged,
  // two tabs) can't overwrite each other. fn mutates the user and may run more
  // than once; it may throw to abort without saving.
  // fn edits the record in place; returning storage.UNCHANGED skips the write.
  update: (uid, fn) => (uid ? userWrite(uid, () => storage.updateJSON(`users/id/${uid}.json`, (u) => (fn(u) === storage.UNCHANGED ? storage.UNCHANGED : u))) : null),
  async create(user) {
    // Re-creating a deleted account doesn't hand out a second free shoot.
    const prior = await storage.getJSON(deletedKey(user.email));
    if (prior?.usage) user.usage = { ...prior.usage, ...user.usage };
    // So does another address for the same mailbox (dots, +tags) whose free
    // shoot was already claimed: the plan says so up front, instead of the
    // studio refusing at develop time.
    if (await storage.getJSON(freeClaimKey(user.email))) user.usage = { ...user.usage, freeShootUsed: true };
    // Another address for the same mailbox starts with that mailbox's checks used.
    const mailboxUsed = await mailboxChecks.used(user.email);
    if (mailboxUsed > (user.usage?.checks || 0)) user.usage = { ...user.usage, checks: mailboxUsed };
    // The account record (unique id) is written first, then the address is
    // claimed write-once, so two sign-ups for the same email at the same moment
    // can't both succeed. A claim pointing at a missing account (an interrupted
    // sign-up) is taken over; the loser's record is removed.
    await storage.putJSON(`users/id/${user.id}.json`, user);
    if (!(await storage.createJSON(emailKey(user.email), { id: user.id }))) {
      const ref = await storage.getJSON(emailKey(user.email));
      if (ref && ref.id !== user.id && (await this.byId(ref.id))) {
        await storage.del([`users/id/${user.id}.json`]).catch(() => {});
        return null;
      }
      await storage.putJSON(emailKey(user.email), { id: user.id });
    }
    return user;
  },
  // Delete the account and every shoot, selfie and headshot in it. The only
  // account usage kept is under a hash of the email (see the privacy policy).
  // Random-ID erasure barriers stop late workers; payment records live under
  // payments/ for accounting.
  async beginRemoval(uid) {
    await storage.putJSON(cancelledUserKey(uid), { cancelled: true });
    await purgeUserPhotos(uid);
  },
  async remove(user) {
    await this.beginRemoval(user.id);
    for (const key of await storage.list(`idx/${user.id}/`)) {
      const sid = key.split("/").pop();
      const meta = await storage.getJSON(`shoots/${sid}.json`);
      await shoots.remove(meta || { id: sid, userId: user.id });
    }
    await storage.del(await storage.list(`idx/${user.id}/`));
    await removeShootCatalog(user.id);
    await storage.del(`billing-sync/${user.id}.json`);
    const usage = user.usage || {};
    if (usage.freeShootUsed || usage.checks) {
      await storage.putJSON(deletedKey(user.email), { usage: { freeShootUsed: !!usage.freeShootUsed, checks: usage.checks || 0 }, deletedAt: new Date().toISOString() });
    }
    await storage.del([emailKey(user.email), `users/id/${user.id}.json`]);
    await storage.putJSON(cancelledUserKey(user.id), { cancelled: true, erased: true });
    await storage.del(`users/id/${user.id}.json`);
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

// Finished frames don't change once their render is long over (a retry only
// resets failed frames, and every new develop plans new frame ids), so each
// server instance keeps them in memory instead of re-reading them on every
// progress check or page view.
const SETTLED_MS = 10 * 60 * 1000;
const settled = new Map();
async function readShot(sid, shotId) {
  const key = `${sid}/${shotId}`;
  if (settled.has(key)) return settled.get(key);
  const doc = await storage.getJSON(`shots/${key}.json`);
  if (doc?.status === "done" && Date.now() - Date.parse(doc.finishedAt || doc.updatedAt || "") > SETTLED_MS) {
    if (settled.size >= 5000) settled.delete(settled.keys().next().value);
    settled.set(key, doc);
  }
  return doc;
}

export const shoots = {
  async getMeta(sid) {
    const meta = await storage.getJSON(`shoots/${sid}.json`);
    return !meta || await shootCancelled(sid, meta.userId) ? null : meta;
  },
  cancel: (sid) => storage.putJSON(cancelledShootKey(sid), { cancelled: true }),
  async get(sid) {
    const meta = await this.getMeta(sid);
    if (!meta) return null;
    const docs = await Promise.all((meta.shots || []).map((s) => readShot(sid, s.id)));
    return merge(meta, docs);
  },
  async saveMeta(meta) {
    meta.updatedAt = new Date().toISOString();
    // Only the plan is stored on the meta; runtime state lives in shot records.
    const clean = { ...meta, shots: (meta.shots || []).map(({ id, lookId, backdrop, outfit, take }) => ({ id, lookId, backdrop, outfit, take })) };
    await shootWrite(meta.id, [`shoots/${meta.id}.json`], () => storage.putJSON(`shoots/${meta.id}.json`, clean), meta.userId);
    return meta;
  },
  // Atomic read-modify-write of the meta (see storage.updateJSON). fn gets the
  // stored meta (plan only, no runtime shot state) and returns it, or returns
  // false to leave it unchanged.
  updateMeta: (sid, fn) =>
    shootWrite(sid, [`shoots/${sid}.json`], () => storage.updateJSON(`shoots/${sid}.json`, (m) => {
      const out = fn(m);
      if (out === false) return storage.UNCHANGED;
      return { ...m, updatedAt: new Date().toISOString(), shots: (m.shots || []).map(({ id, lookId, backdrop, outfit, take }) => ({ id, lookId, backdrop, outfit, take })) };
    })).catch((err) => { if (err.status === 410) return null; throw err; }),
  getShot: (sid, shotId) => storage.getJSON(`shots/${sid}/${shotId}.json`),
  saveShot: (sid, shot) => shootWrite(sid, [`shots/${sid}/${shot.id}.json`], () => storage.putJSON(`shots/${sid}/${shot.id}.json`, { ...shot, updatedAt: new Date().toISOString() })),

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
    if (await shootCancelled(sid)) return false;
    if (await shootWrite(sid, [key], () => storage.createJSON(key, doc)).catch((err) => { if (err.status === 410) return false; throw err; })) return true;
    let won = false;
    await storage.updateJSON(key, (d) => {
      won = d.status === "pending";
      return won ? doc : storage.UNCHANGED;
    });
    if (await shootCancelled(sid)) { await storage.del(key); return false; }
    return won;
  },
  // Writes fields to a frame only while `claim` still owns it. Returns false
  // if the claim was lost (or the frame was cleared).
  async writeShot(sid, shotId, claim, fields) {
    if (await shootCancelled(sid)) return false;
    let owned = false;
    await storage.updateJSON(`shots/${sid}/${shotId}.json`, (d) => {
      owned = d.claim === claim;
      return owned ? { ...d, ...fields, id: shotId, claim, updatedAt: new Date().toISOString() } : storage.UNCHANGED;
    });
    if (await shootCancelled(sid)) { await storage.del(`shots/${sid}/${shotId}.json`); return false; }
    return owned;
  },
  // Conditional update: fn gets the stored frame and returns true to save
  // its changes. Returns whether it saved.
  async updateShot(sid, shotId, fn) {
    if (await shootCancelled(sid)) return false;
    let saved = false;
    await storage.updateJSON(`shots/${sid}/${shotId}.json`, (d) => {
      saved = fn(d) === true;
      return saved ? { ...d, updatedAt: new Date().toISOString() } : storage.UNCHANGED;
    });
    if (await shootCancelled(sid)) { await storage.del(`shots/${sid}/${shotId}.json`); return false; }
    return saved;
  },
  async clearShots(sid) {
    await storage.del(await storage.list(`shots/${sid}/`));
  },
  async create(meta) {
    await this.saveMeta(meta);
    try {
      await shootWrite(meta.id, [`idx/${meta.userId}/${meta.id}`], () => storage.putJSON(`idx/${meta.userId}/${meta.id}`, { createdAt: meta.createdAt }), meta.userId);
      await catalogShoot(meta);
    } catch (err) {
      // Creation has not consumed any allowance. A failed secondary index
      // write must not leave an invisible draft in the account's history.
      await this.remove(meta).catch((cleanup) => console.error("[shoot-catalog] create cleanup", meta.id, cleanup.message));
      throw err;
    }
    return meta;
  },
  async forUser(uid) {
    const keys = await storage.list(`idx/${uid}/`);
    const metas = await mapLimit(keys, 8, (k) => storage.getJSON(`shoots/${k.split("/").pop()}.json`));
    return metas.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async remove(meta) {
    await this.cancel(meta.id);
    await purgeShootPhotos(meta.id, meta.userId);
    const media = await storage.list(`media/${meta.id}/`);
    const shots = await storage.list(`shots/${meta.id}/`);
    const jobs = await storage.list(`jobs/shoots/${meta.id}/`);
    await storage.del([...media, ...shots, ...jobs, `shoots/${meta.id}.json`, `idx/${meta.userId}/${meta.id}`, `claims/develop/${meta.id}.json`]);
    await uncatalogShoot(meta).catch((err) => console.warn("[shoot-catalog] remove", meta.id, err.message));
  },
};

export async function saveMedia(sid, buffer, ext = "jpg") {
  const file = `${sid}/${crypto.randomBytes(12).toString("base64url")}.${ext}`;
  await shootWrite(sid, [`media/${file}`], () => storage.putFile(`media/${file}`, buffer, ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg"));
  return file;
}

export const readMedia = (file) => storage.getFile(`media/${file}`);
export const writeMedia = (file, buffer) => shootWrite(file.split("/")[0], [`media/${file}`], () => storage.putFile(`media/${file}`, buffer, file.endsWith(".png") ? "image/png" : "image/jpeg"));
export async function deleteMedia(file) {
  await purgePhoto(`media/${file}`);
  await storage.del(`media/${file}`);
}
