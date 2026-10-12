// One durable delivery per develop/retry/regrade. The shoot records are the
// checkpoint: an unfinished delivery is retried, including after a worker dies.
// Only random IDs travel through Queues, never photos or account details.
import crypto, { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { QueueClient } from "@vercel/queue";
import { createJSON, getJSON, updateJSON, del, list, UNCHANGED } from "./storage.js";
import { shoots, id } from "./store.js";

export const SHOOT_TOPIC = "keeper-shoots";
const queue = new QueueClient({ region: process.env.VERCEL_REGION || "iad1" });
const keyFor = (sid, jobId) => `jobs/shoots/${sid}/${jobId}.json`;
const LIVE = ["generating", "reviewing"];
export class ShootPending extends Error {}

export async function prepareShootJob(sid) {
  const jobId = id("job");
  const key = keyFor(sid, jobId);
  await createJSON(key, { sid, jobId, createdAt: new Date().toISOString() });
  try {
    // Publish before committing the paid plan. A failed publish can therefore
    // refund safely; a delivery arriving early waits for that commit below.
    if (process.env.VERCEL) await queue.send(SHOOT_TOPIC, { sid, jobId }, { retentionSeconds: 604800, idempotencyKey: jobId });
    // Vercel doesn't deliver queue messages to an Express app, so a signed
    // request to this deployment's own worker route starts the work too.
    kickShootWorker(sid, jobId);
  } catch (err) {
    await del(key).catch(() => {});
    console.error("[shoot-queue] publish", err.message);
    throw Object.assign(new Error("The studio couldn't start your shoot. Please try again; your shoot hasn't been used."), { status: 503 });
  }
  return jobId;
}

export const discardShootJob = (sid, jobId) => del(keyFor(sid, jobId));

// Upgrade live shoots created by an earlier deployment. Multiple visitors or
// cron workers may race: only one jobId wins the conditional metadata write.
export async function ensureShootJob(sid) {
  const meta = await shoots.getMeta(sid);
  if (!meta || !LIVE.includes(meta.status)) return false;
  const oldJob = meta.jobId && await getJSON(keyFor(sid, meta.jobId));
  if (oldJob && Date.now() - Date.parse(oldJob.createdAt) < 6 * 86400_000) return false;
  const jobId = await prepareShootJob(sid);
  let started = false;
  await shoots.updateMeta(sid, (m) => {
    started = false;
    if (m.jobId !== meta.jobId || !LIVE.includes(m.status)) return false;
    started = true;
    m.jobId = jobId;
  });
  if (!started) await discardShootJob(sid, jobId);
  return started;
}


export async function processShootJob(message) {
  if (!message || typeof message.sid !== "string" || typeof message.jobId !== "string") return;
  const { sid, jobId } = message;
  if (!/^sht_[\w-]+$/.test(sid || "") || !/^job_[\w-]+$/.test(jobId || "")) return;
  const key = keyFor(sid, jobId);
  const job = await getJSON(key);
  if (!job) return;
  const shoot = await shoots.getMeta(sid);
  if (!shoot) return void await del(key);
  if (shoot.jobId !== jobId) {
    // Interrupted producers never leave a paid plan without a delivery: the
    // plan and jobId are written together. Abandon uncommitted intents only.
    if (job.activated || Date.now() - Date.parse(job.createdAt) > 15 * 60_000) return void await del(key);
    throw new ShootPending("Waiting for the shoot plan");
  }
  if (!LIVE.includes(shoot.status)) return void await del(key);
  // One delivery at a time per job. A redelivery (or a request that only
  // looks like one) while another is still working waits its turn, so extra
  // deliveries can't start parallel long-running workers on one shoot.
  const lease = randomUUID();
  let leased = false;
  await updateJSON(key, (j) => {
    leased = false; // the callback may run again after a write conflict
    if (j.lease && Date.parse(j.leaseUntil) > Date.now()) return UNCHANGED;
    leased = true;
    return { ...j, activated: true, lease, leaseUntil: new Date(Date.now() + 290_000).toISOString() };
  });
  if (!leased) throw new ShootPending("Another delivery is developing this shoot");
  const release = () => updateJSON(key, (j) => (j.lease === lease ? { ...j, lease: null, leaseUntil: null } : UNCHANGED)).catch(() => {});
  let moved;
  try {
    const { advance } = await import("./pipeline.js");
    moved = await advance(sid, null, { wait: true });
  } catch (err) {
    await release();
    throw err;
  }
  if (moved && LIVE.includes(moved.status)) {
    await release();
    throw new ShootPending("Shoot is still developing");
  }
  await del(key);
}

export const shootQueueCallback = queue.handleNodeCallback(processShootJob, {
  visibilityTimeoutSeconds: 300,
  retry: (err) => ({ afterSeconds: err instanceof ShootPending ? 5 : 30 }),
});

// Plain Node has a persistent filesystem outbox instead of a Vercel broker.
// Both local servers scan it; an atomic lease prevents duplicate deliveries.
// Restarting the process resumes committed plans without any browser polls.
export function startLocalShootWorker() {
  if (process.env.VERCEL) return;
  const active = new Set();
  let scanning = false;
  const tick = async () => {
    if (scanning || active.size >= 4) return;
    scanning = true;
    try {
      for (const key of await list("jobs/shoots/")) {
        if (active.size >= 4) break;
        if (active.has(key)) continue;
        let claimed = false;
        const token = id("worker");
        const job = await updateJSON(key, (j) => {
          claimed = false;
          if (j.leaseUntil > Date.now() || j.nextAt > Date.now()) return UNCHANGED;
          claimed = true;
          return { ...j, token, leaseUntil: Date.now() + 330_000 };
        });
        if (!claimed || !job) continue;
        active.add(key);
        processShootJob(job).catch(async (err) => {
          if (!(err instanceof ShootPending)) console.error("[shoot-worker]", err.message);
          await updateJSON(key, (j) => j.token === token ? { ...j, leaseUntil: 0, nextAt: Date.now() + (err instanceof ShootPending ? 500 : 30_000) } : UNCHANGED).catch(() => {});
        }).finally(() => active.delete(key));
      }
    } catch (err) {
      console.error("[shoot-worker] scan", err.message);
    } finally {
      scanning = false;
    }
  };
  const timer = setInterval(tick, 500);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}


// ---- Background work on Vercel ------------------------------------------
// Vercel doesn't deliver queue messages to an Express app. A new job starts
// one signed request to this deployment's worker route (it can't chain: a
// self-call made from inside another self-call is refused with a 508), and
// the minute cron (runDueShootJobs) carries on whatever it doesn't finish.
// The job's lease and the frame claims keep runs from duplicating work.
const WORKER_PATH = "/api/internal/shoot-worker";
const workerSecret = () => process.env.SESSION_SECRET || "";
const workerSig = (sid, jobId, exp) => crypto.createHmac("sha256", workerSecret()).update(`shoot-worker:${sid}:${jobId}:${exp}`).digest("base64url");
function workerOrigin() {
  if (process.env.SHOOT_WORKER_ORIGIN) return process.env.SHOOT_WORKER_ORIGIN.replace(/\/$/, "");
  // Preview deployments sit behind Vercel's login; the page's polling covers them.
  if (process.env.VERCEL && process.env.VERCEL_ENV === "production") return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "keeperheadshots.com"}`;
  return null;
}

export async function kickShootWorker(sid, jobId) {
  const origin = workerOrigin();
  if (!origin || !workerSecret()) return false;
  const kick = (async () => {
    const exp = Date.now() + 10 * 60_000;
    try {
      const res = await fetch(origin + WORKER_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sid, jobId, exp, sig: workerSig(sid, jobId, exp) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status !== 202) console.error("[shoot-worker] kick refused", sid, res.status);
      return res.status === 202;
    } catch (err) {
      console.error("[shoot-worker] kick", sid, err.message);
      return false;
    }
  })();
  try { waitUntil(kick); } catch {}
  return kick;
}

// The signed request from kickShootWorker, or null.
export function workerJob(body) {
  const { sid, jobId, exp, sig } = body || {};
  if (!workerSecret() || typeof sid !== "string" || typeof jobId !== "string" || typeof sig !== "string") return null;
  if (!/^sht_[\w-]+$/.test(sid) || !/^job_[\w-]+$/.test(jobId) || !(Number(exp) > Date.now())) return null;
  const want = workerSig(sid, jobId, Number(exp));
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  return { sid, jobId };
}

// Develops one job batch after batch until it's done or this run's time is
// nearly up (a function lives 300 s; each batch may take up to ~270 s, so a
// new batch starts only with room left). A delivery started before the plan
// commits waits for it. Returns "done", "pending" (left for the next run) or
// "busy" (another run holds the job).
async function developJob({ sid, jobId }, until) {
  for (;;) {
    try {
      await processShootJob({ sid, jobId });
      return "done";
    } catch (err) {
      if (!(err instanceof ShootPending)) throw err;
      if (/Another delivery/.test(err.message)) return "busy";
      if (Date.now() > until) return "pending";
      if (/plan/.test(err.message)) await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

export async function runShootWorker(job) {
  // No further self-calls from here (Vercel answers a self-call made inside
  // another with a 508); the minute cron carries on whatever this leaves.
  await developJob(job, Date.now() + 20_000).catch((err) => console.error("[shoot-worker]", job.sid, err.message));
}

// Every minute (vercel.json): carry on every unfinished job. A job whose shoot
// another worker holds is skipped at once (its lease); one that's finished or
// gone is removed. Several shoots develop side by side.
export async function runDueShootJobs({ concurrency = 4 } = {}) {
  const started = Date.now();
  const jobs = (await list("jobs/shoots/"))
    .map((key) => /^jobs\/shoots\/(sht_[\w-]+)\/(job_[\w-]+)\.json$/.exec(key))
    .filter(Boolean)
    .map(([, sid, jobId]) => ({ sid, jobId }));
  const report = { jobs: jobs.length, finished: 0, pending: 0, failed: 0 };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        report[{ done: "finished", busy: "pending", pending: "pending" }[await developJob(job, started + 20_000)]]++;
      } catch (err) {
        report.failed++;
        console.error("[shoot-cron]", job.sid, err.message);
      }
    }
  }));
  return report;
}
