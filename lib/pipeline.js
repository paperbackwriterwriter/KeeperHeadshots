// Orchestrates a shoot: selfie check -> render every look/take -> grade.
//
// Works the same on a long-running server and on serverless (Vercel):
// nothing runs in an endless background loop. Instead, advance() is called on
// every progress poll; it claims pending frames up to the concurrency limit and
// renders each one in the background of that request (waitUntil on Vercel).
// Frames that stall past a lease are marked failed so they can be retried.

import sharp from "sharp";
import { waitUntil } from "@vercel/functions";
import { shoots, saveMedia, readMedia, id } from "./store.js";
import { checkSelfies, generateHeadshot, reviewShots, buildPrompt, AIError } from "./ai.js";
import { lookFor, TAKES_PER_LOOK } from "../public/js/shared/catalog.js";

const CONCURRENCY = Number(process.env.GENERATION_CONCURRENCY || 2);
const LEASE_MS = Number(process.env.RENDER_LEASE_MS || 6 * 60 * 1000);
const claiming = new Set(); // per-instance guard against double-claiming a frame

export function background(promise) {
  const p = promise.catch((err) => console.error("[background]", err));
  try {
    waitUntil(p);
  } catch {
    // Not on Vercel: the promise simply keeps running in this process.
  }
  return p;
}

const stale = (iso) => !iso || Date.now() - new Date(iso).getTime() > LEASE_MS;

// Selfies are stored at 1536px; the models get a smaller copy.
async function asReference(file, size = 1024) {
  const buf = await readMedia(file);
  if (!buf) throw new AIError("A reference photo is missing. Start a new shoot.", { status: 500, retryable: false });
  const data = await sharp(buf).resize(size, size, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { mime: "image/jpeg", data: data.toString("base64") };
}

export async function ingestSelfie(sid, buffer) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    meta = {};
  }
  if (!meta.width || !meta.height) throw new AIError("That file isn't a readable image.", { status: 400, retryable: false });
  if (Math.min(meta.width, meta.height) < 256) throw new AIError("That photo is too small — use photos at least 256px on each side.", { status: 400, retryable: false });
  const out = await sharp(buffer).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const m2 = await sharp(out).metadata();
  return { file: await saveMedia(sid, out, "jpg"), width: m2.width, height: m2.height };
}

// The clearest photos, best first: the image model leans on the first
// reference most, and a few strong references beat many mixed ones.
function referencesFor(shoot, max = 3) {
  const kept = (shoot.check?.photos || []).filter((p) => p.keep && shoot.selfies[p.index]).sort((a, b) => b.score - a.score);
  const chosen = kept.length ? kept.map((p) => shoot.selfies[p.index]) : shoot.selfies;
  return chosen.slice(0, max);
}

/* ------------------------------ Photo check ----------------------------- */

export async function runCheck(sid) {
  const meta = await shoots.getMeta(sid);
  meta.status = "checking";
  meta.checkStartedAt = new Date().toISOString();
  meta.error = null;
  await shoots.saveMeta(meta);
  try {
    const refs = await Promise.all(meta.selfies.map((s) => asReference(s.file)));
    const check = await checkSelfies(refs);
    meta.check = { ...check, at: new Date().toISOString() };
    meta.status = "checked";
    return shoots.saveMeta(meta);
  } catch (err) {
    meta.status = "draft";
    meta.error = err.message;
    await shoots.saveMeta(meta);
    throw err;
  }
}

/* -------------------------------- Develop -------------------------------- */

export function planShots(looks) {
  const shots = [];
  for (const l of looks) {
    const look = lookFor(l.backdrop, l.outfit);
    for (let take = 0; take < TAKES_PER_LOOK; take++) {
      shots.push({ id: id("shot"), lookId: look.id, backdrop: look.backdrop.id, outfit: look.outfit.id, take });
    }
  }
  return shots;
}

async function renderShot(shoot, shot) {
  const look = lookFor(shot.backdrop, shot.outfit);
  const prompt = buildPrompt({ look, take: shot.take, subject: shoot.check?.subject });
  const startedAt = new Date().toISOString();
  let lastErr;
  try {
    const references = await Promise.all(referencesFor(shoot).map((s) => asReference(s.file)));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await generateHeadshot({ references, prompt });
        const jpg = await sharp(out.data).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
        const file = await saveMedia(shoot.id, jpg, "jpg");
        await shoots.saveShot(shoot.id, { id: shot.id, status: "done", file, error: null, startedAt, finishedAt: new Date().toISOString() });
        return;
      } catch (err) {
        lastErr = err;
        if (!(err instanceof AIError) || !err.retryable) break;
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      }
    }
  } catch (err) {
    lastErr = err;
  }
  await shoots.saveShot(shoot.id, { id: shot.id, status: "error", file: null, error: lastErr?.message || "Rendering failed", startedAt, finishedAt: new Date().toISOString() });
}

// Move a shoot forward one step. Safe to call on every poll.
export async function advance(sid) {
  let shoot = await shoots.get(sid);
  if (!shoot) return null;

  if (shoot.status === "checking" && stale(shoot.checkStartedAt)) {
    const meta = await shoots.getMeta(sid);
    Object.assign(meta, { status: "draft", error: "The photo check timed out. Please run it again." });
    await shoots.saveMeta(meta);
    return shoots.get(sid);
  }

  if (shoot.status === "reviewing" && stale(shoot.reviewStartedAt)) {
    const meta = await shoots.getMeta(sid);
    Object.assign(meta, { status: "done", reviewError: "Grading timed out. Retry grading to score your headshots." });
    await shoots.saveMeta(meta);
    return shoots.get(sid);
  }

  if (shoot.status !== "generating") return shoot;

  // Frames whose worker died past the lease become retryable failures.
  for (const s of shoot.shots) {
    if (s.status === "rendering" && stale(s.startedAt)) {
      await shoots.saveShot(sid, { id: s.id, status: "error", file: null, error: "Rendering timed out — retry this frame.", startedAt: s.startedAt });
      Object.assign(s, { status: "error", error: "Rendering timed out — retry this frame." });
    }
  }

  let running = shoot.shots.filter((s) => s.status === "rendering").length;
  for (const s of shoot.shots) {
    if (running >= CONCURRENCY) break;
    const key = `${sid}/${s.id}`;
    if (s.status !== "pending" || claiming.has(key)) continue;
    claiming.add(key);
    const startedAt = new Date().toISOString();
    await shoots.saveShot(sid, { id: s.id, status: "rendering", file: null, error: null, startedAt });
    Object.assign(s, { status: "rendering", startedAt });
    background(renderShot(shoot, s).finally(() => claiming.delete(key)));
    running++;
  }

  const open = shoot.shots.some((s) => s.status === "pending" || s.status === "rendering");
  if (!open) {
    const meta = await shoots.getMeta(sid);
    const done = shoot.shots.filter((s) => s.status === "done");
    if (done.length) {
      Object.assign(meta, { status: "reviewing", reviewStartedAt: new Date().toISOString(), reviewError: null });
      await shoots.saveMeta(meta);
      background(runReview(sid));
    } else {
      Object.assign(meta, { status: "error", error: shoot.shots.find((s) => s.error)?.error || "None of the headshots could be rendered." });
      await shoots.saveMeta(meta);
    }
    shoot = await shoots.get(sid);
  }
  return shoot;
}

export async function startGeneration(meta, looks) {
  await shoots.clearShots(meta.id);
  Object.assign(meta, {
    looks: looks.map((l) => ({ backdrop: l.backdrop.id, outfit: l.outfit.id })),
    review: null,
    reviewError: null,
    error: null,
    status: "generating",
    cover: null,
    doneCount: 0,
    bestScore: null,
  });
  meta.shots = planShots(meta.looks);
  await shoots.saveMeta(meta);
  return advance(meta.id);
}

export async function retryFailed(sid) {
  const shoot = await shoots.get(sid);
  for (const s of shoot.shots.filter((x) => x.status === "error")) {
    await shoots.saveShot(sid, { id: s.id, status: "pending", file: null, error: null });
  }
  const meta = await shoots.getMeta(sid);
  Object.assign(meta, { status: "generating", review: null, reviewError: null, error: null });
  await shoots.saveMeta(meta);
  return advance(sid);
}

/* -------------------------------- Review -------------------------------- */

export async function startReview(sid) {
  const meta = await shoots.getMeta(sid);
  Object.assign(meta, { status: "reviewing", reviewStartedAt: new Date().toISOString(), reviewError: null });
  await shoots.saveMeta(meta);
  background(runReview(sid));
  return shoots.get(sid);
}

export async function runReview(sid) {
  const shoot = await shoots.get(sid);
  const done = shoot.shots.filter((s) => s.status === "done");
  const meta = await shoots.getMeta(sid);
  meta.doneCount = done.length;
  meta.cover = done[0]?.file || null;
  try {
    // Full-size references and shots: likeness judgments need facial detail.
    // Frames use the same numbers the proofs page shows ("Frame 03").
    const frameOf = new Map(shoot.shots.map((s, i) => [s.id, i + 1]));
    const references = await Promise.all(referencesFor(shoot, 4).map((s) => asReference(s.file, 1024)));
    const shotsForReview = await Promise.all(
      done.map(async (s) => {
        const l = lookFor(s.backdrop, s.outfit);
        return { ...(await asReference(s.file, 1024)), frame: frameOf.get(s.id), label: `${l.backdrop.name} · ${l.outfit.name}` };
      }),
    );
    const review = await reviewShots({ references, shots: shotsForReview });
    const byFrame = new Map(done.map((s) => [frameOf.get(s.id), s]));
    const shots = Object.fromEntries(
      review.shots
        .filter((r) => byFrame.has(Math.round(r.frame)))
        .map((r) => [byFrame.get(Math.round(r.frame)).id, { ...r, frame: Math.round(r.frame), overall: Math.max(0, Math.min(100, Math.round(r.overall))) }]),
    );
    // Feature the frame the write-up is about, as long as its score backs it
    // up (top score, or within 2 points of it). Otherwise fall back to the top
    // score so the pick never contradicts the grades shown beside it.
    const ranked = done.filter((s) => shots[s.id]).sort((a, b) => shots[b.id].overall - shots[a.id].overall || shots[b.id].likeness - shots[a.id].likeness);
    const top = ranked[0] || done[0];
    const named = byFrame.get(Math.round(review.best_frame));
    const best = named && shots[named.id] && shots[top.id] && shots[named.id].overall >= shots[top.id].overall - 2 ? named : top;
    meta.review = { headline: review.headline, summary: review.summary, bestShotId: best.id, shots, at: new Date().toISOString() };
    if (best !== named) console.warn(`[review] ${sid}: best_frame ${review.best_frame} not backed by scores; featuring frame ${frameOf.get(best.id)}`);
    // Keep the person's own pick across a regrade if that shot still exists.
    const pick = done.find((s) => s.id === meta.pickedShotId) || best;
    meta.cover = pick.file;
    meta.bestScore = shots[pick.id]?.overall ?? null;
    meta.status = "done";
  } catch (err) {
    meta.status = "done";
    meta.reviewError = err.message;
  }
  await shoots.saveMeta(meta);
}
