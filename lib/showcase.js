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
import sharp from "sharp";
import { list, getJSON, putJSON, getFile, putFile, del, updateJSON } from "./storage.js";
import { readMedia } from "./store.js";

export const SHOWCASE_MAX = 6; // shown on the home page
export const LIMITS = { name: 40, role: 60, quote: 240 };
const MAX_PENDING = 200; // so the queue can't be flooded
const json = (id) => `showcase/${id}.json`;
const jpg = (id) => `showcase/${id}.jpg`;
export const validId = (id) => /^shc_[\w-]{10,30}$/.test(String(id || ""));

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function all() {
  const keys = (await list("showcase/")).filter((k) => k.endsWith(".json"));
  return (await Promise.all(keys.map((k) => getJSON(k).catch(() => null)))).filter(Boolean);
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

export const forUser = async (uid) => (await all()).filter((e) => e.userId === uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
export const forOwner = async () => (await all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const get = (id) => (validId(id) ? getJSON(json(id)) : null);
export const image = (id) => (validId(id) ? getFile(jpg(id)) : null);

// Returns { entry, first } (first: the account had nothing waiting for review,
// so the owner should hear about it), or throws with a status.
export async function submit(user, shoot, shotId, fields) {
  const shot = (shoot.shots || []).find((t) => t.id === shotId && t.status === "done");
  if (!shot) throw Object.assign(new Error("Choose one of your finished headshots."), { status: 400 });
  const name = clean(fields.name, LIMITS.name);
  if (!name) throw Object.assign(new Error("Add the name to show with your headshot."), { status: 400, field: "name" });
  const entries = await all();
  const mine = entries.filter((e) => e.userId === user.id);
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
  // One entry per account. Re-read, so two offers made at the same moment
  // still end with one: the newest stays, older ones go.
  const now = (await all()).filter((e) => e.userId === user.id && e.id !== entry.id);
  await removeEntries(now.filter((e) => e.createdAt < entry.createdAt || (e.createdAt === entry.createdAt && e.id < entry.id)));
  return { entry, first: !mine.some((e) => e.status === "pending") };
}

async function removeEntries(entries) {
  if (!entries.length) return;
  await del(entries.flatMap((e) => [json(e.id), jpg(e.id)]));
  if (entries.some((e) => e.status === "approved")) bust();
}
export const removeForUser = async (uid) => removeEntries((await all()).filter((e) => e.userId === uid));
export const removeForShoot = async (sid) => removeEntries((await all()).filter((e) => e.shootId === sid));
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
