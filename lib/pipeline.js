// Orchestrates a shoot: selfie check -> render every look/take -> grade.
//
// Works the same on a long-running server and on serverless (Vercel):
// nothing runs in an endless background loop. Instead, advance() is called on
// every progress poll; it claims pending frames up to the concurrency limit and
// renders each one in the background of that request (waitUntil on Vercel).
// Frames that stall past a lease are marked failed so they can be retried.
// Claims are atomic in storage (shoots.claimShot), so when several server
// instances poll the same shoot, each frame is still rendered only once.

import sharp from "sharp";
import { waitUntil } from "@vercel/functions";
import { shoots, saveMedia, readMedia, deleteMedia, id } from "./store.js";
import { checkSelfies, generateHeadshot, widenForCircle, qaHeadshot, reviewShots, buildPrompt, AIError } from "./ai.js";
import { lookFor, TAKES_PER_LOOK, MAX_LOOKS } from "../public/js/shared/catalog.js";
import { acquireSlot, releaseSlot } from "./slots.js";
import { notifyReady } from "./notify.js";

const CONCURRENCY = Number(process.env.GENERATION_CONCURRENCY || 2);
const LEASE_MS = Number(process.env.RENDER_LEASE_MS || 6 * 60 * 1000);

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
  // Phone photos are ~12–50 MP; refuse absurd dimensions before decoding them.
  if (meta.width * meta.height > 60e6) throw new AIError("That photo's dimensions are too large. Try a regular phone photo.", { status: 400, retryable: false });
  const out = await sharp(buffer, { limitInputPixels: 60e6 }).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
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

// Moves the shoot into "checking" atomically. Returns the start time, or null
// if a check is already running (a double-click or a second tab) or the photos
// can no longer be changed.
export async function beginCheck(sid) {
  const startedAt = new Date().toISOString();
  let ok = false;
  await shoots.updateMeta(sid, (m) => {
    const editable = !m.sample && ["draft", "checked", "error"].includes(m.status) && !(m.shots || []).length;
    const staleRun = m.status === "checking" && stale(m.checkStartedAt) && !(m.shots || []).length;
    if (!m.selfies?.length || !(editable || staleRun)) return false;
    ok = true;
    Object.assign(m, { status: "checking", checkStartedAt: startedAt, error: null });
  });
  return ok ? startedAt : null;
}

// Text saved on a shoot or frame is shown to its owner: AI errors carry a
// customer-ready message; anything else (storage, image decoding) is logged
// and replaced with a plain one.
function userMessage(err, fallback) {
  if (err instanceof AIError) return err.message;
  if (err) console.error("[pipeline]", err.message);
  return fallback;
}

// Where a shoot goes when a check doesn't finish: back to "checked" if an
// earlier check still describes these photos (they can't change while
// checking), otherwise to "draft".
export const statusWithoutCheck = (m) => (m.check ? "checked" : "draft");

// Runs a check started by beginCheck. Photos can't change while checking, and
// the result is written only if this run still owns the shoot.
export async function runCheck(sid, startedAt) {
  const meta = await shoots.getMeta(sid);
  const mine = (m) => m.status === "checking" && m.checkStartedAt === startedAt;
  try {
    const refs = await Promise.all(meta.selfies.map((s) => asReference(s.file)));
    const check = await checkSelfies(refs);
    await shoots.updateMeta(sid, (m) => {
      if (!mine(m)) return false;
      Object.assign(m, { check: { ...check, at: new Date().toISOString() }, status: "checked" });
    });
  } catch (err) {
    await shoots.updateMeta(sid, (m) => {
      if (!mine(m)) return false;
      Object.assign(m, { status: statusWithoutCheck(m), error: userMessage(err, "The photo check didn't finish. Please run it again.") });
    });
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

// Each frame is rendered, then checked by the quality gate (likeness and
// professional finish) before anyone sees it. A frame that fails is rendered
// again with the gate's specific directions, up to QA_ATTEMPTS times, within
// a time budget that fits the function's 300 s limit. A frame that never
// passes is not shown; it becomes a free retry.
const QA_ATTEMPTS = Number(process.env.QA_ATTEMPTS || 3);
const RENDER_BUDGET_MS = 240_000;
// No AI call may run past this point after a frame starts: the function is
// stopped at 300 s, and a frame cut off there is lost until its lease expires.
const HARD_STOP_MS = 285_000;
const timeLeft = (hardStop) => hardStop - Date.now() - 5_000;
const QA_FAILED = "This frame didn't pass our quality check for likeness and polish, so we held it back. Retry it; retries are free.";

// Retries a failed render once after 4 s, or, when the image API says it's at
// its per-minute quota (429), up to twice after 15–25 s so the window resets.
async function generateWithRetry(references, prompt, deadline = Infinity, hardStop = Infinity) {
  for (let i = 0; ; i++) {
    try {
      if (timeLeft(hardStop) < 20_000) throw new AIError("This frame ran out of time. Retry it; retries are free.");
      return await generateHeadshot({ references, prompt, timeoutMs: Number.isFinite(hardStop) ? timeLeft(hardStop) : undefined });
    } catch (err) {
      const busy = err instanceof AIError && err.status === 429;
      if (!(err instanceof AIError) || !err.retryable || i >= (busy ? 2 : 1)) throw err;
      const wait = busy ? 15_000 + Math.random() * 10_000 : 4000;
      if (deadline - Date.now() < wait + 60_000) throw err;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// A frame needs a widened square when there's too little room above the hair,
// or the head is off-center, for LinkedIn's and Teams' circular crop.
const tightForCircle = (head) => !!head && (head.top < 0.07 || Math.abs((head.left + head.right) / 2 - 0.5) > 0.08);

// Asks the image model to widen a finished headshot into a 1:1 square with
// breathing room, then puts it through the same quality gate (likeness,
// finish, framing). Only a square that passes is attached to the frame;
// otherwise downloads use the face-centered crop of the portrait.
async function widenSquare(sid, shotId, claim, jpg, references, look, hardStop = Infinity) {
  try {
    const src = { mime: "image/jpeg", data: (await sharp(jpg).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer()).toString("base64") };
    const out = await widenForCircle(src, Number.isFinite(hardStop) ? timeLeft(hardStop) : undefined);
    // Always exactly square (center crop if the model returns another shape), at most 1024 px.
    const { width: w, height: h } = await sharp(out.data).metadata();
    const side = Math.min(w, h);
    const sq = await sharp(out.data)
      .extract({ left: Math.floor((w - side) / 2), top: Math.floor((h - side) / 2), width: side, height: side })
      .resize(Math.min(side, 1024))
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    const candidate = { mime: "image/jpeg", data: (await sharp(sq).jpeg({ quality: 88 }).toBuffer()).toString("base64") };
    if (timeLeft(hardStop) < 15_000) return; // no time to check it: keep the face-centered crop
    const qa = await qaHeadshot({ references, candidate, look, timeoutMs: Number.isFinite(hardStop) ? timeLeft(hardStop) : undefined });
    const head = headBox(qa.head_box);
    if (!qa.passed || !head || head.top < 0.05) {
      console.info("[square] widened square rejected", sid, shotId, `likeness ${qa.likeness}`, head ? `top ${head.top.toFixed(2)}` : "no head box");
      return;
    }
    const file = await saveMedia(sid, sq, "jpg");
    const attached = await shoots.updateShot(sid, shotId, (s) => {
      if (s.status !== "done" || s.claim !== claim) return false;
      s.square = file;
      return true;
    });
    // The frame was retried or the shoot deleted meanwhile: don't leave the file behind.
    if (!attached) await deleteMedia(file).catch(() => {});
  } catch (err) {
    console.warn("[square] widening failed", sid, shotId, err.message);
  }
}

// The head's position from the quality check (fractions of the image), used
// to place the square profile-photo crop. Null if it isn't usable.
function headBox(b) {
  if (!b) return null;
  const c = (v) => Math.min(1, Math.max(0, Number(v)));
  const box = { top: c(b.top), bottom: c(b.bottom), left: c(b.left), right: c(b.right) };
  return box.bottom - box.top > 0.05 && box.right - box.left > 0.05 ? box : null;
}

// Thrown when this worker no longer owns the frame (it timed out and the frame
// was retried, or the shoot was restarted): stop without writing anything.
class ClaimLost extends Error {}

async function renderShot(shoot, shot, claim, startedAt) {
  const look = lookFor(shot.backdrop, shot.outfit);
  const base = buildPrompt({ look, take: shot.take, subject: shoot.check?.subject });
  const deadline = Date.now() + RENDER_BUDGET_MS;
  const hardStop = Date.now() + HARD_STOP_MS;
  const write = async (fields) => {
    if (!(await shoots.writeShot(shoot.id, shot.id, claim, fields))) throw new ClaimLost();
  };
  const progress = (stage, attempt) => write({ status: "rendering", stage, attempt, file: null, error: null, startedAt });
  let lastErr = null;
  let direction = "";
  const history = [];
  try {
    const references = await Promise.all(referencesFor(shoot).map((s) => asReference(s.file)));
    for (let attempt = 1; attempt <= QA_ATTEMPTS; attempt++) {
      // Don't start an attempt that can't finish (render + check) in time.
      if (attempt > 1 && deadline - Date.now() < 90_000) break;
      await progress("render", attempt);
      let out;
      try {
        out = await generateWithRetry(references, direction ? `${base}\n\nRetake direction from our quality check of the previous attempt: ${direction}` : base, deadline, hardStop);
      } catch (err) {
        if (err instanceof ClaimLost) throw err;
        lastErr = err;
        if (!(err instanceof AIError) || !err.retryable) break;
        continue;
      }
      const jpg = await sharp(out.data).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      await progress("qa", attempt);
      let qa;
      try {
        const candidate = { mime: "image/jpeg", data: (await sharp(jpg).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer()).toString("base64") };
        if (timeLeft(hardStop) < 15_000) throw new AIError("This frame ran out of time before its quality check. Retry it; retries are free.");
        qa = await qaHeadshot({ references, candidate, look, timeoutMs: timeLeft(hardStop) });
      } catch (err) {
        // An unchecked frame is never delivered; try again.
        console.warn("[qa] check failed", shoot.id, shot.id, err.message);
        lastErr = err;
        continue;
      }
      const summary = { attempt, passed: qa.passed, likeness: qa.likeness, professional: qa.professional, issues: qa.issues, head: headBox(qa.head_box) };
      history.push(summary);
      if (qa.passed) {
        const file = await saveMedia(shoot.id, jpg, "jpg");
        try {
          await write({ status: "done", file, error: null, startedAt, finishedAt: new Date().toISOString(), stage: null, attempt, qa: { ...summary, history } });
        } catch (err) {
          // Claim lost (frame retried, or the shoot was deleted): remove the orphan.
          await deleteMedia(file).catch(() => {});
          throw err;
        }
        // The frame is already delivered; a roomier square is a bonus that
        // only runs when it can finish well inside the time budget.
        if (tightForCircle(summary.head) && deadline - Date.now() > 100_000) await widenSquare(shoot.id, shot.id, claim, jpg, references, look, hardStop);
        return;
      }
      console.info("[qa] retake", shoot.id, shot.id, `attempt ${attempt}`, `likeness ${qa.likeness}`, `professional ${qa.professional}`, qa.issues.map((i) => i.detail).join("; "));
      direction = qa.retake_direction || qa.issues.map((i) => i.detail).join("; ");
      lastErr = new AIError(QA_FAILED, { retryable: false });
    }
  } catch (err) {
    if (err instanceof ClaimLost) return void console.info("[render] claim lost, stopping", shoot.id, shot.id);
    lastErr = err;
  }
  const message = lastErr?.message === QA_FAILED || history.length ? QA_FAILED : userMessage(lastErr, "Rendering failed. Try this frame again.");
  await write({ status: "error", file: null, error: message, startedAt, finishedAt: new Date().toISOString(), stage: null, qa: history.length ? { history } : null }).catch((err) => {
    if (!(err instanceof ClaimLost)) throw err;
  });
}

// True if more than CONCURRENCY frames of this shoot are rendering, counting
// the one just claimed. Every frame that sees too many steps back, whatever
// order they started in: of two frames claimed at the same moment, the one
// checked second always sees the other, so they can't both go ahead. (Ranking
// by start time let both through when the earlier-stamped claim was written
// last.) A frame that steps back starts on a later poll.
async function overLimit(sid, shots) {
  const docs = await Promise.all(shots.map((x) => shoots.getShot(sid, x.id)));
  return docs.filter((d) => d?.status === "rendering" && !stale(d.startedAt)).length > CONCURRENCY;
}

// Move a shoot forward one step. Safe to call on every poll.
// `loaded` is the shoot as the caller just read it (saves re-reading the shoot
// and every frame on each progress poll).
export async function advance(sid, loaded = null) {
  let shoot = loaded || (await shoots.get(sid));
  if (!shoot) return null;

  // Status changes below are conditional writes: when several instances poll
  // at once, only the first applies each one.
  if (shoot.status === "checking" && stale(shoot.checkStartedAt)) {
    await shoots.updateMeta(sid, (m) => {
      if (m.status !== "checking" || !stale(m.checkStartedAt)) return false;
      Object.assign(m, { status: statusWithoutCheck(m), error: "The photo check timed out. Please run it again." });
    });
    return shoots.get(sid);
  }

  if (shoot.status === "reviewing" && stale(shoot.reviewStartedAt)) {
    // The headshots are still there; fill in what grading would have (count
    // and cover) so the dashboard doesn't show an empty shoot.
    const done = (shoot.shots || []).filter((s) => s.status === "done");
    await shoots.updateMeta(sid, (m) => {
      if (m.status !== "reviewing" || !stale(m.reviewStartedAt)) return false;
      Object.assign(m, { status: "done", reviewError: "Grading timed out. Retry grading to score your headshots." });
      if (done.length) Object.assign(m, { doneCount: done.length, cover: m.cover || done[0].file });
    });
    await notifyReady(sid).catch((err) => console.error("[notify]", sid, err.message));
    return shoots.get(sid);
  }

  if (shoot.status !== "generating") return shoot;

  // Frames whose worker died past the lease become retryable failures. Clearing
  // the claim also stops that worker if it's somehow still running.
  const TIMED_OUT = "Rendering timed out — retry this frame.";
  for (const s of shoot.shots) {
    if (s.status !== "rendering" || !stale(s.startedAt)) continue;
    const timedOut = await shoots.updateShot(sid, s.id, (d) => {
      if (d.status !== "rendering" || !stale(d.startedAt)) return false;
      Object.assign(d, { status: "error", file: null, error: TIMED_OUT, stage: null, claim: null });
      return true;
    });
    // If the frame finished just before the sweep, re-read it rather than
    // counting it as failed.
    if (timedOut) Object.assign(s, { status: "error", error: TIMED_OUT });
    else {
      const d = await shoots.getShot(sid, s.id);
      if (d) Object.assign(s, { status: d.status, file: d.file ?? null, error: d.error ?? null });
    }
  }

  let running = shoot.shots.filter((s) => s.status === "rendering").length;
  let queued = false;
  for (const s of shoot.shots) {
    if (running >= CONCURRENCY) break;
    if (s.status !== "pending") continue;
    const claim = id("clm");
    const startedAt = new Date().toISOString();
    // Another instance may have claimed it since we read the shoot.
    if (!(await shoots.claimShot(sid, s.id, claim, startedAt))) continue;
    // Other servers (or tabs) polling this shoot at the same moment claim
    // frames too, so check the real total now that this claim is written.
    // Over the limit, the claim is given back and picked up on a later poll.
    // If storage fails here, the claim is handed back too rather than left
    // on a frame nobody renders until its lease runs out.
    const stepBack = () =>
      shoots.updateShot(sid, s.id, (d) => {
        if (d.claim !== claim || d.status !== "rendering") return false;
        Object.assign(d, { status: "pending", claim: null, startedAt: null, stage: null });
        return true;
      });
    // Then a site-wide slot (lib/slots.js): with every slot taken the frame
    // stays queued and a later poll starts it.
    let over, slot;
    try {
      over = await overLimit(sid, shoot.shots);
      slot = !over && (await acquireSlot(claim, { sid, shotId: s.id, until: Date.parse(startedAt) + LEASE_MS }));
    } catch (err) {
      await stepBack().catch(() => {});
      throw err;
    }
    if (over || !slot) {
      await stepBack();
      if (!slot && !over) queued = true;
      break;
    }
    Object.assign(s, { status: "rendering", startedAt });
    background(renderShot(shoot, s, claim, startedAt).finally(() => releaseSlot(claim).catch((err) => console.warn("[slots] release", err.message))));
    running++;
  }

  const open = shoot.shots.some((s) => s.status === "pending" || s.status === "rendering");
  if (!open) {
    const done = shoot.shots.filter((s) => s.status === "done");
    let started = false;
    await shoots.updateMeta(sid, (m) => {
      // Only the first instance to get here moves the shoot on.
      if (m.status !== "generating") return false;
      if (done.length) {
        started = true;
        Object.assign(m, { status: "reviewing", reviewStartedAt: new Date().toISOString(), reviewError: null });
      } else {
        Object.assign(m, { status: "error", error: shoot.shots.find((s) => s.error)?.error || "None of the headshots could be rendered." });
      }
    });
    if (started) background(runReview(sid));
    shoot = await shoots.get(sid);
  }
  // Nothing of this shoot is rendering because the site's slots are all in
  // use: the studio says it's waiting its turn (not stored).
  return queued && !running ? { ...shoot, queued: true } : shoot;
}

export async function startGeneration(meta, looks) {
  await shoots.clearShots(meta.id);
  const plan = {
    looks: looks.map((l) => ({ backdrop: l.backdrop.id, outfit: l.outfit.id })),
    review: null,
    reviewError: null,
    error: null,
    status: "generating",
    cover: null,
    doneCount: 0,
    bestScore: null,
    ...(meta.paidWith ? { paidWith: meta.paidWith } : {}),
    // A free shoot's headshots are a watermarked preview (lib/preview.js).
    ...(meta.preview ? { preview: true } : {}),
  };
  plan.shots = planShots(plan.looks);
  // Written against the stored shoot, and only if it's still checked and
  // undeveloped: a photo added (or a re-check started) since the caller read
  // it isn't overwritten, and the caller refunds the shoot instead.
  let started = false;
  await shoots.updateMeta(meta.id, (m) => {
    if (m.status !== "checked" || (m.shots || []).length) return false;
    started = true;
    Object.assign(m, plan);
  });
  if (!started) throw Object.assign(new Error("Your photos changed while the shoot was starting. Check them again, then develop."), { status: 409 });
  Object.assign(meta, plan);
  // From here the shoot is under way (the next progress poll carries it on),
  // so a hiccup in this first step must not reach the caller, which would
  // refund the shoot while it still develops.
  return advance(meta.id).catch((err) => {
    console.error("[generate] first step", meta.id, err.message);
    return meta;
  });
}

// Adds looks to a finished shoot (a preview offer's extra looks): their
// frames are planned and developed alongside the ones already there, and the
// whole shoot is graded again. Only from a settled shoot (done or error);
// returns false otherwise, and the caller gives the credit back.
export async function addLooks(sid, looks) {
  const more = looks.map((l) => ({ backdrop: l.backdrop.id, outfit: l.outfit.id }));
  const frames = planShots(more);
  let started = false;
  await shoots.updateMeta(sid, (m) => {
    if (!["done", "error"].includes(m.status) || (m.looks || []).length + more.length > MAX_LOOKS) return false;
    started = true;
    Object.assign(m, { looks: [...(m.looks || []), ...more], shots: [...(m.shots || []), ...frames], status: "generating", review: null, reviewError: null, error: null });
  });
  if (!started) return false;
  await advance(sid).catch((err) => console.error("[more-looks] first step", sid, err.message));
  return true;
}

export async function retryFailed(sid) {
  const shoot = await shoots.get(sid);
  for (const s of shoot.shots.filter((x) => x.status === "error")) {
    await shoots.updateShot(sid, s.id, (d) => {
      if (d.status !== "error") return false;
      Object.assign(d, { status: "pending", file: null, error: null, stage: null, claim: null });
      return true;
    });
  }
  // A grading started from another tab in the same moment keeps its run; the
  // reset frames are picked up by the next resume (which accepts pending ones).
  await shoots.updateMeta(sid, (m) => {
    if (m.status === "reviewing" && !stale(m.reviewStartedAt)) return false;
    Object.assign(m, { status: "generating", review: null, reviewError: null, error: null });
  });
  return advance(sid);
}

/* -------------------------------- Review -------------------------------- */

// `onStart(meta)` runs inside the same atomic write, only when a grading
// really starts (the regrade count, so a refused start isn't counted); it may
// throw to refuse.
export async function startReview(sid, onStart = null) {
  let started = false;
  await shoots.updateMeta(sid, (m) => {
    // A double-click (or two tabs) must not start two gradings, and a shoot
    // whose frames are developing again (a retry) isn't ready to grade.
    if (m.status === "reviewing" && !stale(m.reviewStartedAt)) return false;
    if (!["done", "error", "reviewing"].includes(m.status)) return false;
    onStart?.(m);
    started = true;
    // A regrade isn't news: the "ready" email is for a shoot's first finish.
    m.readyEmailedAt ||= new Date().toISOString();
    Object.assign(m, { status: "reviewing", reviewStartedAt: new Date().toISOString(), reviewError: null });
  });
  if (started) background(runReview(sid));
  return shoots.get(sid);
}

export async function runReview(sid) {
  const shoot = await shoots.get(sid);
  const done = shoot.shots.filter((s) => s.status === "done");
  const startedAt = shoot.reviewStartedAt;
  // The grading result is collected here and applied atomically at the end,
  // so a rename or pick made meanwhile isn't overwritten.
  const meta = { pickedShotId: shoot.pickedShotId, doneCount: done.length, cover: done[0]?.file || null };
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
    meta.reviewError = userMessage(err, "Grading didn't finish.");
  }
  await shoots.updateMeta(sid, (m) => {
    // A retry started meanwhile, or another review took over: don't clobber it.
    if (m.status !== "reviewing" || (startedAt && m.reviewStartedAt && m.reviewStartedAt !== startedAt)) return false;
    const pick = done.find((s) => s.id === m.pickedShotId);
    Object.assign(m, meta, { pickedShotId: m.pickedShotId });
    if (!meta.reviewError) delete m.reviewError;
    if (pick) m.cover = pick.file;
  });
  await notifyReady(sid).catch((err) => console.error("[notify]", sid, err.message));
}
