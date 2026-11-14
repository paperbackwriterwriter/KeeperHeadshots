// Customer reviews: a paying customer can rate the site (1 to 5 stars) and
// write a few words, at /app/review. One review per account; sending another
// replaces it and it waits for approval again. Nothing is treated as public
// until an owner approves it (/app/reviews), and the customer can delete
// theirs at any time. Deleting the account removes it too.
//
// Stored as reviews/<account id>.json.

import { list, getJSON, putJSON, del, updateJSON, UNCHANGED } from "./storage.js";
import { accountDeleting } from "./store.js";
import { ADDRESS_LIKE } from "./mail.js";
import { cleanName, cleanText } from "./teams.js";

export const LIMITS = { name: 40, text: 600 };
export const REVIEWS_SHOWN = 6;
const key = (uid) => `reviews/${uid}.json`;
const validUid = (uid) => /^usr_[\w-]{4,40}$/.test(String(uid || ""));

// Who may leave a review: someone who paid and wasn't fully refunded.
export const canReview = (u) => !!u && !u.demo && (u.purchases || []).some((p) => !p.refunded);

const linkLike = (s) => /https?:|www\.|[<>]/i.test(s.normalize("NFKC").replace(/[‌‍]/g, "")) || ADDRESS_LIKE.test(s);
const fail = (message, field) => Object.assign(new Error(message), { status: 400, field });

export const get = (uid) => (validUid(uid) ? getJSON(key(uid)) : null);
export const ownReview = (r) => r && { rating: r.rating, text: r.text, name: r.name, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt };

// Returns { review, first } (first: nothing of theirs was waiting for
// approval, so the owner should hear about it), or throws with a status.
export async function submit(user, fields = {}) {
  const rating = Number(fields.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail("Choose 1 to 5 stars.", "rating");
  const name = cleanName(typeof fields.name === "string" ? fields.name : "", LIMITS.name);
  if (!name) throw fail("Add the name to show with your review.", "name");
  if (linkLike(name) || /@/.test(name)) throw fail("Use just your name, with no links or addresses.", "name");
  const raw = typeof fields.text === "string" ? fields.text : "";
  if (raw.trim().length > LIMITS.text) throw fail(`Keep your review to ${LIMITS.text} characters.`, "text");
  const text = cleanText(raw).replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  if (text && linkLike(text)) throw fail("Leave out links and web addresses.", "text");
  if (fields.consent !== true) throw fail("Tick the box to give your permission.", "consent");
  if (await accountDeleting(user.id)) throw Object.assign(new Error("This account is being deleted."), { status: 409 });
  const before = await get(user.id);
  const now = new Date().toISOString();
  const review = { userId: user.id, rating, text, name, status: "pending", consentAt: now, createdAt: before?.createdAt || now, updatedAt: now };
  await putJSON(key(user.id), review);
  if (await accountDeleting(user.id)) {
    await del(key(user.id));
    throw Object.assign(new Error("This account is being deleted."), { status: 409 });
  }
  if (before?.status === "approved") bust();
  return { review, first: before?.status !== "pending" };
}

export async function remove(uid) {
  if (!validUid(uid)) return false;
  const r = await get(uid);
  if (!r) return false;
  await del(key(uid));
  if (r.status === "approved") bust();
  return true;
}
// After a refund: a customer who no longer has a paid purchase loses their review.
export async function removeIfNotCustomer(uid) {
  const { users } = await import("./store.js");
  const u = await users.byId(uid).catch(() => null);
  if (u && !canReview(u)) await remove(uid);
}
// An account taken over (server.js purgeForTakeover): its earlier holder's review.
export async function removeBefore(uid, since) {
  const r = await get(uid);
  if (r && (r.createdAt || "") < since) await remove(uid);
}

async function all() {
  const keys = (await list("reviews/")).filter((k) => k.endsWith(".json"));
  const out = [];
  for (let i = 0; i < keys.length; i += 16) out.push(...(await Promise.all(keys.slice(i, i + 16).map((k) => getJSON(k).catch(() => null)))));
  return out.filter((r) => r && validUid(r.userId));
}
export const forOwner = async () => (await all()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

// `seen`: the updatedAt of the version the owner read; if the customer has
// changed it since, nothing is decided (409) and the owner reads it again.
export async function decide(uid, status, seen) {
  if (!["approved", "rejected", "pending"].includes(status)) throw Object.assign(new Error("Unknown status."), { status: 400 });
  if (!validUid(uid) || !(await get(uid))) return null;
  let changed = false;
  const r = await updateJSON(key(uid), (x) => {
    changed = false;
    if (!x?.userId) return UNCHANGED; // deleted meanwhile
    if (seen && x.updatedAt !== seen) return void (changed = true) || UNCHANGED;
    return { ...x, status, decidedAt: new Date().toISOString() };
  });
  if (changed) throw Object.assign(new Error("The customer changed this review since you loaded it. Read it again before deciding."), { status: 409 });
  if (!r?.userId) return null;
  bust();
  return r;
}

// Approved reviews with their count and average, cached briefly.
let cache = { at: 0, value: null };
const bust = () => (cache = { at: 0, value: null });
export async function approved() {
  if (cache.value && Date.now() - cache.at < 60_000) return cache.value;
  const list = (await all()).filter((r) => r.status === "approved").sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)));
  const count = list.length;
  const average = count ? Math.round((list.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10 : null;
  const value = { count, average, reviews: list.slice(0, REVIEWS_SHOWN).map((r) => ({ name: r.name, rating: r.rating, text: r.text, date: String(r.createdAt || "").slice(0, 10) })) };
  cache = { at: Date.now(), value };
  return value;
}
