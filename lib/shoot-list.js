// A compact chronological catalog avoids listing and loading every shoot on
// each dashboard visit. Only the requested page's live metadata is read.
// Existing accounts build this ID/date catalog once from their index markers.
import { createJSON, getJSON, updateJSON, list, del, UNCHANGED } from "./storage.js";
import { accountDeleting, shoots } from "./store.js";
import { mapLimit } from "./collections.js";

const key = (uid) => `shoot-catalog/${uid}.json`;
const order = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
const invalid = () => Object.assign(new Error("That shoot history page isn't valid. Refresh and try again."), { status: 400 });

async function catalogWrite(uid, write) {
  if (await accountDeleting(uid)) return null;
  const result = await write();
  if (await accountDeleting(uid)) { await del(key(uid)); return null; }
  return result;
}

async function catalog(uid) {
  let doc = await getJSON(key(uid));
  if (doc) return doc;
  const markers = await list(`idx/${uid}/`);
  const items = (await mapLimit(markers, 8, async (k) => {
    const marker = await getJSON(k);
    return marker?.createdAt ? { id: k.split("/").pop(), createdAt: marker.createdAt } : null;
  })).filter(Boolean).sort(order);
  await catalogWrite(uid, () => createJSON(key(uid), { items }));
  return await getJSON(key(uid)) || { items: [] };
}

export async function catalogShoot(meta) {
  await catalog(meta.userId);
  await catalogWrite(meta.userId, () => updateJSON(key(meta.userId), (doc) => {
    if (doc.items.some((s) => s.id === meta.id)) return UNCHANGED;
    return { items: [...doc.items, { id: meta.id, createdAt: meta.createdAt }].sort(order) };
  }));
}

export async function uncatalogShoot(meta) {
  await updateJSON(key(meta.userId), (doc) => ({ items: doc.items.filter((s) => s.id !== meta.id) }));
}
export const removeShootCatalog = (uid) => del(key(uid));

export async function listShootPage(uid, { cursor = null, limit = 24 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 48) throw invalid();
  let before;
  if (cursor != null) {
    if (typeof cursor !== "string" || cursor.length > 300 || !/^[\w-]+$/.test(cursor)) throw invalid();
    try { before = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); } catch { throw invalid(); }
    if (!before || typeof before !== "object" || Array.isArray(before) || before.uid !== uid || !/^sht_[\w-]+$/.test(before.id || "") || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(before.createdAt || "")) throw invalid();
  }
  if (await accountDeleting(uid)) return { shoots: [], nextCursor: null };
  const doc = await catalog(uid);
  const start = before ? doc.items.findIndex((s) => order(s, before) > 0) : 0;
  if (start === -1) return { shoots: [], nextCursor: null };
  const selected = doc.items.slice(start, start + limit);
  const metas = await mapLimit(selected, 8, (s) => shoots.getMeta(s.id));
  const last = selected.at(-1);
  return {
    shoots: metas.filter((s) => s && s.userId === uid),
    nextCursor: last && start + selected.length < doc.items.length ? Buffer.from(JSON.stringify({ uid, ...last })).toString("base64url") : null,
  };
}
