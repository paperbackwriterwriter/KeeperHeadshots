// Orchestrates a shoot: selfie check -> render every look/take -> grade.
// Runs in-process; the browser polls the shoot for progress.

import sharp from "sharp";
import { shoots, saveMedia, readMedia, id } from "./store.js";
import { checkSelfies, generateHeadshot, reviewShots, buildPrompt, AIError } from "./ai.js";
import { lookFor, TAKES_PER_LOOK } from "../public/js/shared/catalog.js";

const CONCURRENCY = Number(process.env.GENERATION_CONCURRENCY || 2);
const running = new Set();

// Selfies are stored at 1536px; the models get a 1024px copy.
async function asReference(file, size = 1024) {
  const data = await sharp(readMedia(file)).resize(size, size, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { mime: "image/jpeg", data: data.toString("base64") };
}

export async function ingestSelfie(buffer) {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new AIError("That file isn't a readable image.", { status: 400, retryable: false });
  if (Math.min(meta.width, meta.height) < 256) throw new AIError("One photo is too small — use photos at least 256px on each side.", { status: 400, retryable: false });
  const out = await sharp(buffer).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const m2 = await sharp(out).metadata();
  return { file: saveMedia(out, "jpg"), width: m2.width, height: m2.height };
}

function referencesFor(shoot) {
  const keep = shoot.check?.photos?.filter((p) => p.keep).map((p) => p.index) ?? [];
  const chosen = keep.length ? keep.map((i) => shoot.selfies[i]).filter(Boolean) : shoot.selfies;
  return chosen.slice(0, 4);
}

export async function runCheck(shootId) {
  const shoot = shoots.byId(shootId);
  shoots.update(shootId, (s) => {
    s.status = "checking";
    s.error = null;
  });
  try {
    const refs = await Promise.all(shoot.selfies.map((s) => asReference(s.file)));
    const check = await checkSelfies(refs);
    return shoots.update(shootId, (s) => {
      s.check = { ...check, at: new Date().toISOString() };
      s.status = "checked";
    });
  } catch (err) {
    shoots.update(shootId, (s) => {
      s.status = "draft";
      s.error = err.message;
    });
    throw err;
  }
}

export function planShots(looks) {
  const shots = [];
  for (const l of looks) {
    const look = lookFor(l.backdrop, l.outfit);
    for (let take = 0; take < TAKES_PER_LOOK; take++) {
      shots.push({ id: id("shot"), lookId: look.id, backdrop: look.backdrop.id, outfit: look.outfit.id, take, status: "pending", file: null, error: null });
    }
  }
  return shots;
}

async function renderShot(shootId, shot, references, subject) {
  const look = lookFor(shot.backdrop, shot.outfit);
  const prompt = buildPrompt({ look, take: shot.take, subject });
  shoots.update(shootId, (s) => {
    const t = s.shots.find((x) => x.id === shot.id);
    t.status = "rendering";
    t.error = null;
    t.startedAt = new Date().toISOString();
  });
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await generateHeadshot({ references, prompt });
      const jpg = await sharp(out.data).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      const file = saveMedia(jpg, "jpg");
      shoots.update(shootId, (s) => {
        const t = s.shots.find((x) => x.id === shot.id);
        Object.assign(t, { status: "done", file, finishedAt: new Date().toISOString() });
      });
      return true;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof AIError) || !err.retryable) break;
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  shoots.update(shootId, (s) => {
    const t = s.shots.find((x) => x.id === shot.id);
    Object.assign(t, { status: "error", error: lastErr?.message || "Rendering failed" });
  });
  return false;
}

export async function runReview(shootId) {
  const shoot = shoots.byId(shootId);
  const done = shoot.shots.filter((s) => s.status === "done");
  if (!done.length) return;
  shoots.update(shootId, (s) => {
    s.status = "reviewing";
    s.reviewError = null;
  });
  try {
    const references = await Promise.all(referencesFor(shoot).slice(0, 2).map((s) => asReference(s.file, 768)));
    const shotsForReview = await Promise.all(
      done.map(async (s) => ({ ...(await asReference(s.file, 768)), label: lookFor(s.backdrop, s.outfit).backdrop.name + " · " + lookFor(s.backdrop, s.outfit).outfit.name })),
    );
    const review = await reviewShots({ references, shots: shotsForReview });
    shoots.update(shootId, (s) => {
      s.review = {
        headline: review.headline,
        summary: review.summary,
        bestShotId: done[review.best_shot_index].id,
        shots: Object.fromEntries(
          review.shots.filter((r) => done[r.index]).map((r) => [done[r.index].id, { ...r, overall: Math.max(0, Math.min(100, Math.round(r.overall))) }]),
        ),
        at: new Date().toISOString(),
      };
      s.status = "done";
    });
  } catch (err) {
    shoots.update(shootId, (s) => {
      s.status = "done";
      s.reviewError = err.message;
    });
  }
}

export async function runGeneration(shootId, { onlyFailed = false } = {}) {
  if (running.has(shootId)) return;
  running.add(shootId);
  try {
    const shoot = shoots.byId(shootId);
    const references = await Promise.all(referencesFor(shoot).map((s) => asReference(s.file)));
    const queue = shoot.shots.filter((s) => (onlyFailed ? s.status === "error" : s.status !== "done"));
    shoots.update(shootId, (s) => {
      s.status = "generating";
      s.error = null;
      if (onlyFailed) s.review = null;
    });
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const shot = queue.shift();
        await renderShot(shootId, shot, references, shoot.check?.subject);
      }
    });
    await Promise.all(workers);
    const after = shoots.byId(shootId);
    if (!after.shots.some((s) => s.status === "done")) {
      const firstErr = after.shots.find((s) => s.error)?.error;
      shoots.update(shootId, (s) => {
        s.status = "error";
        s.error = firstErr || "None of the headshots could be rendered.";
      });
      return;
    }
    await runReview(shootId);
  } catch (err) {
    shoots.update(shootId, (s) => {
      s.status = "error";
      s.error = err.message;
    });
  } finally {
    running.delete(shootId);
  }
}

// If the server restarted mid-shoot, mark in-flight work as interrupted so the
// user can resume it instead of watching a spinner forever.
export function recoverInterrupted(all) {
  for (const s of all) {
    if (["generating", "reviewing", "checking"].includes(s.status)) {
      shoots.update(s.id, (x) => {
        for (const t of x.shots || []) if (t.status === "rendering" || t.status === "pending") Object.assign(t, { status: "error", error: "Interrupted — resume to finish this shot." });
        x.status = x.status === "checking" ? "draft" : x.shots?.some((t) => t.status === "done") ? "done" : "error";
        if (x.status === "error") x.error = "The shoot was interrupted. Resume to finish it.";
      });
    }
  }
}
