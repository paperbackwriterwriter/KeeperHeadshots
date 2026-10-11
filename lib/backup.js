// Nightly backup of every record the business runs on: accounts and their
// shoot index, payments, refunds, free-shoot and develop claims, usage, shoots
// and their frame records, teams and invites, contact messages and the funnel
// counts. It's one gzipped JSON
// snapshot a day, backups/<YYYY-MM-DD>.json.gz, and the last KEEP_DAYS
// days are kept.
//
// Where it goes: a second, private Vercel Blob store connected to the project
// with the env prefix BACKUP (BACKUP_STORE_ID, signed in with the project's
// Vercel OIDC token; or an older-style BACKUP_READ_WRITE_TOKEN), so a problem
// with the main store doesn't take the backups with it. Without one, the main
// store, which still covers mistakes and bad writes but not losing the store.
//
// Photos and headshots (media/) aren't included: they're large and kept only
// for a limited time anyway. Restore with scripts/restore-backup.js.

import zlib from "node:zlib";
import { list, getJSON, getFile, putFile, del, NAMESPACE } from "./storage.js";

export const PREFIXES = ["users/", "idx/", "shoot-catalog/", "showcase-users/", "billing-sync/", "cancelled/", "jobs/", "payments/", "refunds/", "claims/", "usage/", "shoots/", "shots/", "teams/", "invites/", "contact/", "showcase/", "stats/days/", "stats/seen/"];
export const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const PARALLEL = 16;

let blobSdk;
const sdk = async () => (blobSdk ??= await import("@vercel/blob"));
const token = () => process.env.BACKUP_READ_WRITE_TOKEN || "";
const storeId = () => process.env.BACKUP_STORE_ID || "";

// Credentials for the backup store, or null for the main store. With a store
// id the OIDC token is passed explicitly, so the SDK can't quietly fall back
// to the main store's token.
async function auth() {
  if (token()) return { token: token() };
  if (!storeId()) return null;
  const { getVercelOidcToken } = await import("@vercel/functions/oidc");
  const oidcToken = await getVercelOidcToken().catch(() => "");
  if (!oidcToken) throw new Error("BACKUP_STORE_ID is set, but there's no Vercel OIDC token to reach that store");
  return { storeId: storeId(), oidcToken };
}

// The backup store: the separate one when configured, else the main store.
export const target = {
  separate: () => !!(token() || storeId()),
  async put(key, buf) {
    const a = await auth();
    if (!a) return putFile(key, buf, "application/gzip");
    const { put } = await sdk();
    await put(key, buf, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/gzip", ...a });
  },
  async get(key) {
    const a = await auth();
    if (!a) return getFile(key);
    const { get } = await sdk();
    const res = await get(key, { access: "private", useCache: false, ...a });
    return res?.statusCode === 200 ? Buffer.from(await new Response(res.stream).arrayBuffer()) : null;
  },
  async list(prefix) {
    const a = await auth();
    if (!a) return list(prefix);
    const { list: blobList } = await sdk();
    const out = [];
    let cursor;
    do {
      const page = await blobList({ prefix, cursor, limit: 1000, ...a });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async del(keys) {
    if (!keys.length) return;
    const a = await auth();
    if (!a) return del(keys);
    const { del: blobDel } = await sdk();
    for (let i = 0; i < keys.length; i += 100) await blobDel(keys.slice(i, i + 100), a);
  },
};

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export async function runBackup({ now = Date.now(), budgetMs = 240_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const keys = (await Promise.all(PREFIXES.map((p) => list(p)))).flat().filter((k) => k.endsWith(".json") || k.startsWith("idx/")); // index entries have no extension
  const records = {};
  let failed = 0;
  let complete = true;
  for (let i = 0; i < keys.length; i += PARALLEL) {
    if (Date.now() >= deadline) {
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
  // A namespaced copy (a preview deployment) keeps its backups in its own
  // part of the main store: the backup store holds the live site's only.
  let separateStore = target.separate() && !NAMESPACE;
  try {
    if (!separateStore) await putFile(key, buf, "application/gzip");
    else await target.put(key, buf);
  } catch (err) {
    if (!separateStore) throw err;
    // The backup store couldn't be reached: keep tonight's copy in the main
    // store rather than none, and say so (this reaches the alert email).
    console.error("[backup] backup store unavailable, saved to the main store instead:", err.message);
    await putFile(key, buf, "application/gzip");
    separateStore = false;
  }

  // Keep the newest KEEP_DAYS snapshots. Nothing is pruned after an incomplete
  // one, so a run of short nights can't age out the last complete snapshot.
  const store = separateStore ? target : { list, del };
  const all = (await store.list("backups/")).filter((k) => /^backups\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(k)).sort();
  const old = complete && !failed ? all.slice(0, Math.max(0, all.length - KEEP_DAYS)) : [];
  if (old.length) await store.del(old);

  const report = { key, records: snapshot.count, listed: keys.length, failed, complete, bytes: buf.length, separateStore, pruned: old.length };
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
