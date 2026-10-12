// One durable delivery per develop/retry/regrade. The shoot records are the
// checkpoint: an unfinished delivery is retried, including after a worker dies.
// Only random IDs travel through Queues, never photos or account details.
import { randomUUID } from "node:crypto";
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
