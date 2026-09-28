// Nightly backup of every record the business runs on: accounts, payments,
// refunds, free-shoot and develop claims, usage, shoots and their frame
// records, contact messages and the funnel counts. It's one gzipped JSON
// snapshot a day, backups/<YYYY-MM-DD>.json.gz, and the last KEEP_DAYS
// days are kept.
//
// Where it goes: a second Vercel Blob store when BACKUP_READ_WRITE_TOKEN is
// set (connect a private store to the project with the env prefix BACKUP),
// so a problem with the main store doesn't take the backups with it.
// Otherwise the main store, which still covers mistakes and bad writes but
// not losing the store itself.
//
// Photos and headshots (media/) aren't included: they're large and kept only
// for a limited time anyway. Restore with scripts/restore-backup.js.

import zlib from "node:zlib";
import { list, getJSON, getFile, putFile, del } from "./storage.js";

export const PREFIXES = ["users/", "payments/", "refunds/", "claims/", "usage/", "shoots/", "shots/", "contact/", "stats/days/"];
export const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const PARALLEL = 16;

let blobSdk;
const sdk = async () => (blobSdk ??= await import("@vercel/blob"));
const token = () => process.env.BACKUP_READ_WRITE_TOKEN || "";

// The backup store: the separate one when configured, else the main store.
export const target = {
  separate: () => !!token(),
  async put(key, buf) {
    if (!token()) return putFile(key, buf, "application/gzip");
    const { put } = await sdk();
    await put(key, buf, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/gzip", token: token() });
  },
  async get(key) {
    if (!token()) return getFile(key);
    const { get } = await sdk();
    const res = await get(key, { access: "private", useCache: false, token: token() });
    return res?.statusCode === 200 ? Buffer.from(await new Response(res.stream).arrayBuffer()) : null;
  },
  async list(prefix) {
    if (!token()) return list(prefix);
    const { list: blobList } = await sdk();
    const out = [];
    let cursor;
    do {
      const page = await blobList({ prefix, cursor, limit: 1000, token: token() });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async del(keys) {
    if (!keys.length) return;
    if (!token()) return del(keys);
    const { del: blobDel } = await sdk();
    for (let i = 0; i < keys.length; i += 100) await blobDel(keys.slice(i, i + 100), { token: token() });
  },
};

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export async function runBackup({ now = Date.now(), budgetMs = 240_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const keys = (await Promise.all(PREFIXES.map((p) => list(p)))).flat().filter((k) => k.endsWith(".json"));
  const records = {};
  let failed = 0;
  let complete = true;
  for (let i = 0; i < keys.length; i += PARALLEL) {
    if (Date.now() > deadline) {
      complete = false;
      break;
    }
    await Promise.all(
      keys.slice(i, i + PARALLEL).map(async (k) => {
        try {
          const v = await getJSON(k);
          if (v !== null) records[k] = v;
        } catch (err) {
          failed++;
          console.warn("[backup] couldn't read", k, err.message);
        }
      }),
    );
  }
  const snapshot = { version: 1, at: new Date(now).toISOString(), complete, count: Object.keys(records).length, records };
  const buf = zlib.gzipSync(JSON.stringify(snapshot));
  const key = `backups/${dayOf(now)}.json.gz`;
  await target.put(key, buf);

  // Keep the newest KEEP_DAYS snapshots.
  const all = (await target.list("backups/")).filter((k) => /^backups\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(k)).sort();
  const old = all.slice(0, Math.max(0, all.length - KEEP_DAYS));
  await target.del(old);

  const report = { key, records: snapshot.count, listed: keys.length, failed, complete, bytes: buf.length, separateStore: target.separate(), pruned: old.length };
  // An incomplete or partly failed backup is an error, so it reaches the alert email.
  if (!complete || failed) console.error("[backup] incomplete", JSON.stringify(report));
  return report;
}

// Reads a snapshot (a key in the backup store, or the newest one).
export async function readBackup(key = null) {
  const name = key || (await target.list("backups/")).filter((k) => k.endsWith(".json.gz")).sort().pop();
  if (!name) return null;
  const buf = await target.get(name);
  return buf ? { key: name, ...JSON.parse(zlib.gunzipSync(buf).toString("utf8")) } : null;
}
