// Customer results: people can offer one of their headshots, with their first
// name, job and a short quote, to be shown on the home page. Nothing is shown
// until an owner approves it (/app/showcase), and the person can take it down
// at any time from the shoot or their account page. Deleting the shoot or the
// account removes it too.
//
// Stored as showcase/<id>.json plus a copy of the headshot, showcase/<id>.jpg,
// so the entry doesn't depend on the shoot's own files. One entry per account:
// offering another headshot replaces the earlier one.

import crypto from "node:crypto";
import { purgePhoto } from "./photo-backup.js";
import sharp from "sharp";
import { list, getJSON, putJSON, getFile, putFile, del, updateJSON, createJSON } from "./storage.js";
import { readMedia, users, shoots, accountDeleting } from "./store.js";
import { mapLimit } from "./collections.js";
import { isPreview, isKept } from "./preview.js";

export const SHOWCASE_MAX = 6; // shown on the home page
export const LIMITS = { name: 40, role: 60, quote: 240 };
const MAX_PENDING = 200; // so the queue can't be flooded
const json = (id) => `showcase/${id}.json`;
const jpg = (id) => `showcase/${id}.jpg`;
export const validId = (id) => /^shc_[\w-]{10,30}$/.test(String(id || ""));

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function all() {
  const keys = (await list("showcase/")).filter((k) => k.endsWith(".json"));
  const out = [];
  for (let i = 0; i < keys.length; i += 16) out.push(...(await Promise.all(keys.slice(i, i + 16).map((k) => getJSON(k).catch(() => null)))));
  return out.filter(Boolean);
}

// Public list, cached briefly on this server (the CDN caches it too).
let cache = { at: 0, entries: null };
const bust = () => (cache = { at: 0, entries: null });
export async function approved() {
  if (cache.entries && Date.now() - cache.at < 60_000) return cache.entries;
  const entries = (await all())
    .filter((e) => e.status === "approved")
    .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))
    .slice(0, SHOWCASE_MAX)
    .map(publicEntry);
  cache = { at: Date.now(), entries };
  return entries;
}
export const publicEntry = (e) => ({ id: e.id, name: e.name, role: e.role, quote: e.quote, v: (e.decidedAt || e.createdAt || "").replace(/\D/g, "").slice(-10) });
export const ownEntry = (e) => e && { id: e.id, shootId: e.shootId, shotId: e.shotId, name: e.name, role: e.role, quote: e.quote, status: e.status, createdAt: e.createdAt };

const userIndex = (uid) => `showcase-users/${uid}.json`;
async function indexWrite(uid, write) {
  if (await accountDeleting(uid)) return false;
  const result = await write();
  if (await accountDeleting(uid)) { await del(userIndex(uid)); return false; }
  return result !== null;
}
async function userEntries(uid) {
  const indexed = await getJSON(userIndex(uid));
  if (indexed) return (await mapLimit(indexed.ids, 8, get)).filter((e) => e?.userId === uid);
  // One-time migration, including an empty marker: accounts with no shared
  // headshot must not scan the site's collection on every visit either.
  const mine = (await all()).filter((e) => e.userId === uid);
  await indexWrite(uid, () => createJSON(userIndex(uid), { ids: mine.map((e) => e.id) }));
  const current = await getJSON(userIndex(uid));
  return current ? (await mapLimit(current.ids, 8, get)).filter((e) => e?.userId === uid) : mine;
}
export const forUser = async (uid) => (await userEntries(uid)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] || null;
export const forOwner = async () => (await all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const get = (id) => (validId(id) ? getJSON(json(id)) : null);
export const image = (id) => (validId(id) ? getFile(jpg(id)) : null);

// Returns { entry, first } (first: the account had nothing waiting for review,
// so the owner should hear about it), or throws with a status.
// Offers from one account run one after another here, so a form submitted
// twice in the same moment ends with one entry, not two.
const inFlight = new Map();
export function submit(user, shoot, shotId, fields) {
  const prev = inFlight.get(user.id) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => submitOne(user, shoot, shotId, fields));
  inFlight.set(user.id, run);
  return run.finally(() => inFlight.get(user.id) === run && inFlight.delete(user.id));
}
async function submitOne(user, shoot, shotId, fields) {
  const shot = (shoot.shots || []).find((t) => t.id === shotId && t.status === "done");
  if (!shot) throw Object.assign(new Error("Choose one of your finished headshots."), { status: 400 });
  const name = clean(fields.name, LIMITS.name);
  if (!name) throw Object.assign(new Error("Add the name to show with your headshot."), { status: 400, field: "name" });
  const flat = name.normalize("NFKC").replace(/[\u200b-\u200f\u2060\ufeff]/g, "").replace(/[。．]/g, ".");
  if (/https?:|www\.|[@<>]|\.(com|net|org|io|co|ly|me|example)\b/i.test(flat)) throw Object.assign(new Error("Use just your name, with no links or addresses."), { status: 400, field: "name" });
  const entries = await all();
  const mine = await userEntries(user.id);
  if (!mine.length && entries.filter((e) => e.status === "pending").length >= MAX_PENDING) {
    throw Object.assign(new Error("We can't take new submissions right now. Please try again in a few days."), { status: 503 });
  }
  const src = await readMedia(shot.file);
  if (!src) throw Object.assign(new Error("We couldn't find that headshot. Try another one."), { status: 400 });
  const entry = {
    id: `shc_${crypto.randomBytes(12).toString("base64url")}`,
    userId: user.id,
    shootId: shoot.id,
    shotId,
    name,
    role: clean(fields.role, LIMITS.role),
    quote: clean(fields.quote, LIMITS.quote),
    status: "pending",
    consentAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  await putFile(jpg(entry.id), await sharp(src).rotate().resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer(), "image/jpeg");
  await putJSON(json(entry.id), entry);
  try {
    const saved = await indexWrite(user.id, () => updateJSON(userIndex(user.id), (doc) => ({ ids: [...new Set([...doc.ids, entry.id])] })));
    if (!saved) throw Object.assign(new Error("Your shared headshot couldn't be saved. Refresh and try again."), { status: 409 });
  } catch (err) {
    await del([json(entry.id), jpg(entry.id)]);
    throw err;
  }
  // One entry per account. Re-read, so two offers made at the same moment
  // still end with one: the newest stays, older ones go.
  const now = (await userEntries(user.id)).filter((e) => e.id !== entry.id);
  await removeEntries(now.filter((e) => e.createdAt < entry.createdAt || (e.createdAt === entry.createdAt && e.id < entry.id)));
  return { entry, first: !mine.some((e) => e.status === "pending") };
}

async function removeEntries(entries) {
  if (!entries.length) return;
  for (const e of entries) await purgePhoto(jpg(e.id));
  await del(entries.flatMap((e) => [json(e.id), jpg(e.id)]));
  for (const uid of new Set(entries.map((e) => e.userId))) {
    const gone = new Set(entries.filter((e) => e.userId === uid).map((e) => e.id));
    await updateJSON(userIndex(uid), (doc) => ({ ids: doc.ids.filter((id) => !gone.has(id)) }));
  }
  if (entries.some((e) => e.status === "approved")) bust();
}
export async function removeForUser(uid) {
  await removeEntries(await userEntries(uid));
  await del(userIndex(uid));
}
export const removeForShoot = async (sid) => removeEntries((await all()).filter((e) => e.shootId === sid));
// A kept preview headshot whose purchase was refunded can't stay on show.
export const removeForShot = async (uid, sid, shotId) => removeEntries((await userEntries(uid)).filter((e) => e.shootId === sid && e.shotId === shotId));
// After a refund or dispute locks a free preview again, its headshot can't
// stay on show: the copy here was made without the watermark.
export async function removeLocked(uid) {
  const mine = await userEntries(uid);
  if (!mine.length) return;
  const u = await users.byId(uid);
  const locked = [];
  for (const e of mine) {
    const meta = await shoots.getMeta(e.shootId);
    if (!meta || (isPreview(meta, u) && !isKept(u, e.shootId, e.shotId))) locked.push(e);
  }
  await removeEntries(locked);
}
// A refunded package: the refund policy asks people not to use headshots
// from a refunded shoot, so an entry from a credit-paid shoot comes down.
// Whether a shoot was paid for by the refunded package `sid`. A shoot from
// before packages were tracked (no paidBy) counts when the account has no
// other package that could have paid for it.
const paidByRefunded = (paidBy, sid, others) => (paidBy ? paidBy === sid : !others);
// Another live package that could have paid for a shoot made at `before`.
const otherPackages = (u, sid, before) => (u?.purchases || []).some((p) => !p.refunded && p.shoots > 0 && p.sessionId !== sid && !(before && String(p.at || "") > before));

export async function removeForRefund(uid, sid = null) {
  const mine = await userEntries(uid);
  if (!mine.length) return;
  const u = await users.byId(uid);
  const gone = [];
  for (const e of mine) {
    const meta = await shoots.getMeta(e.shootId);
    if (!meta || (meta.paidWith === "credit" && paidByRefunded(meta.paidBy, sid, otherPackages(u, sid, meta.createdAt)))) gone.push(e);
  }
  await removeEntries(gone);
}
// A colleague's team shoot was paid for by the admin's package; when that
// package is refunded, their shared headshot comes down too.
export async function removeForTeamRefund(ownerId, sid = null) {
  const owner = await users.byId(ownerId);
  if (!owner?.teamId) return;
  const gone = [];
  for (const e of await all()) {
    if (e.userId === ownerId) continue;
    const meta = await shoots.getMeta(e.shootId);
    if (meta?.paidWith === "team" && meta.team?.id === owner.teamId && paidByRefunded(meta.team.paidBy, sid, otherPackages(owner, sid, meta.createdAt))) gone.push(e);
  }
  await removeEntries(gone);
}
export async function remove(id) {
  const e = await get(id);
  if (e) await removeEntries([e]);
  return !!e;
}

export async function decide(id, status) {
  if (!["approved", "rejected", "pending"].includes(status)) throw Object.assign(new Error("Unknown status."), { status: 400 });
  if (!validId(id)) return null;
  const e = await updateJSON(json(id), (x) => ({ ...x, status, decidedAt: new Date().toISOString() }));
  bust();
  return e;
}
