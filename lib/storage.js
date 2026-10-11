// Key/value + file storage with two backends behind one interface:
//   - Vercel Blob (private store) when BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID is set
//   - the local filesystem (./data) otherwise
// Keys are slash-separated paths, e.g. "shoots/sht_x.json".

import fs from "node:fs/promises";
import path from "node:path";

const useBlob = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
export const backend = useBlob ? "blob" : "fs";

/* ------------------------------ Filesystem ------------------------------ */

const ROOT = path.resolve(process.env.DATA_DIR || "data");
const abs = (key) => {
  const p = path.resolve(ROOT, key);
  if (!p.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key");
  return p;
};

const fsLocks = new Map();

// Cross-process lock: exclusive create of a lock file. A lock older than 10 s
// is treated as abandoned (its process died mid-update) and taken over.
async function lockFile(lock) {
  await fs.mkdir(path.dirname(lock), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      const h = await fs.open(lock, "wx");
      await h.close();
      return () => fs.rm(lock, { force: true });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const age = await fs.stat(lock).then((st) => Date.now() - st.mtimeMs, () => 0);
      if (age > 10_000) await fs.rm(lock, { force: true });
      else if (i > 500) throw Object.assign(new Error("That's taking longer than usual. Please try again."), { status: 503 });
      else await new Promise((r) => setTimeout(r, 5 + Math.random() * 20));
    }
  }
}

const fsStore = {
  async getBuffer(key) {
    try {
      return await fs.readFile(abs(key));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  },
  async put(key, body) {
    const p = abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, p);
  },
  async create(key, body) {
    const p = abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    try {
      await fs.writeFile(p, body, { flag: "wx" });
      return true;
    } catch (err) {
      if (err.code === "EEXIST") return false;
      throw err;
    }
  },
  // An in-process queue per key, plus a lock file so that several local
  // server processes sharing one DATA_DIR (a stand-in for several serverless
  // instances) also update atomically.
  async update(key, fn) {
    const prev = fsLocks.get(key) || Promise.resolve();
    let release;
    const mine = new Promise((r) => (release = r));
    fsLocks.set(key, prev.then(() => mine));
    await prev;
    const unlock = await lockFile(abs(key) + ".lock").catch((err) => (release(), Promise.reject(err)));
    try {
      const buf = await this.getBuffer(key);
      if (!buf) return null;
      const value = JSON.parse(buf.toString("utf8"));
      const next = fn(value);
      if (next === UNCHANGED) return value;
      await this.put(key, JSON.stringify(next));
      return next;
    } finally {
      await unlock();
      release();
      if (fsLocks.get(key) === mine) fsLocks.delete(key);
    }
  },
  // Every file under the prefix, like Vercel Blob's list (not just one level).
  async list(prefix) {
    const dir = abs(prefix.replace(/\/$/, "") || ".");
    try {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && !e.name.endsWith(".tmp") && !e.name.endsWith(".lock"))
        .map((e) => `${prefix.replace(/\/?$/, "/")}${path.relative(dir, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join("/")}`);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  },
  async folders(prefix) {
    try {
      const entries = await fs.readdir(abs(prefix.replace(/\/$/, "") || "."), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  },
  async del(keys) {
    await Promise.all(keys.map((k) => fs.rm(abs(k), { force: true, recursive: true })));
  },
};

/* ------------------------------ Vercel Blob ----------------------------- */

let blobSdk;
const sdk = async () => (blobSdk ??= await import("@vercel/blob"));

const blobStore = {
  async getBuffer(key) {
    const { get } = await sdk();
    // useCache:false — this is live app state, never serve a stale copy.
    // Blob now and then answers a read with a 5xx; a read is safe to repeat,
    // so retry once before failing the request.
    const res = await get(key, { access: "private", useCache: false }).catch(async (err) => {
      if (!/\b5\d\d\b/.test(String(err?.message))) throw err;
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
      return get(key, { access: "private", useCache: false });
    });
    if (!res || res.statusCode !== 200) return null;
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  },
  async put(key, body, contentType) {
    const { put } = await sdk();
    await put(key, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 60 });
  },
  async create(key, body, contentType) {
    const { put, head } = await sdk();
    try {
      // Without allowOverwrite, Blob refuses to replace an existing blob.
      await put(key, body, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType });
      return true;
    } catch (err) {
      if (await head(key).then(() => true, () => false)) return false;
      throw err;
    }
  },
  // Optimistic concurrency: write only if the blob's ETag is unchanged since
  // we read it, and retry on conflict. fn may run more than once.
  //
  // The ETag comes from head() (the blob's metadata, which is what ifMatch is
  // checked against), read BEFORE the content. The download's own ETag header
  // can differ (e.g. for a compressed response) and then never matches. If
  // the content changes between the two reads, the write fails and retries,
  // so a newer version is never overwritten.
  async update(key, fn) {
    const { get, head, put, BlobPreconditionFailedError, BlobNotFoundError } = await sdk();
    let conflicts = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      let meta;
      try {
        meta = await head(key);
      } catch (err) {
        if (BlobNotFoundError && err instanceof BlobNotFoundError) return null;
        throw err;
      }
      const res = await get(key, { access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
      if (!res || res.statusCode !== 200) return null;
      const value = JSON.parse(Buffer.from(await new Response(res.stream).arrayBuffer()).toString("utf8"));
      const next = fn(value);
      if (next === UNCHANGED) return value;
      try {
        await put(key, JSON.stringify(next), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60, ifMatch: meta.etag });
        return next;
      } catch (err) {
        if (!(err instanceof BlobPreconditionFailedError)) throw err;
        conflicts++;
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
      }
    }
    console.error("[storage] update gave up after conflicts", key, conflicts);
    throw Object.assign(new Error("That's taking longer than usual. Please try again."), { status: 503 });
  },
  async list(prefix) {
    const { list } = await sdk();
    const out = [];
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  // Names of the folders directly under prefix, without listing their files.
  async folders(prefix) {
    const { list } = await sdk();
    const out = [];
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000, mode: "folded" });
      out.push(...page.folders.map((f) => f.slice(prefix.length).replace(/\/$/, "")));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async del(keys) {
    if (!keys.length) return;
    const { del } = await sdk();
    for (let i = 0; i < keys.length; i += 100) await del(keys.slice(i, i + 100));
  },
};

const impl = useBlob ? blobStore : fsStore;

// Preview builds use the same Blob store as the live site, so everything a
// preview writes (sign-ups, shoots, test payments, counters) is kept under
// "preview/", apart from live customer data. Example headshots are shared: a
// preview shows the live site's. STORAGE_NAMESPACE overrides the prefix.
export const NAMESPACE = process.env.STORAGE_NAMESPACE ?? (process.env.VERCEL_ENV === "preview" ? "preview/" : "");
const SHARED = ["examples/"];
const k = (key) => (NAMESPACE && !SHARED.some((p) => key.startsWith(p)) ? NAMESPACE + key : key);
const unk = (key) => (NAMESPACE && key.startsWith(NAMESPACE) ? key.slice(NAMESPACE.length) : key);

export async function getJSON(key) {
  const buf = await impl.getBuffer(k(key));
  return buf ? JSON.parse(buf.toString("utf8")) : null;
}
export const putJSON = (key, value) => impl.put(k(key), JSON.stringify(value), "application/json");
// Atomic read-modify-write of a JSON document: fn receives the current value
// and returns the new one (it may run more than once, and may throw to abort
// without writing). Returns the written value, or null if the key is missing.
// Returned by an updateJSON callback to skip the write (the stored value is
// returned as it is).
export const UNCHANGED = Symbol("unchanged");
export const updateJSON = (key, fn) => impl.update(k(key), fn);
// Writes only if the key doesn't exist yet; returns false if it already did.
export const createJSON = (key, value) => impl.create(k(key), JSON.stringify(value), "application/json");
export const getFile = (key) => impl.getBuffer(k(key));
export const putFile = (key, buf, contentType) => impl.put(k(key), buf, contentType);
// Recovery must not overwrite an image uploaded after its existence check.
export const createFile = (key, buf, contentType) => impl.create(k(key), buf, contentType);
export const list = async (prefix) => (await impl.list(k(prefix))).map(unk);
// Folder names directly under prefix ("media/" -> ["sht_…", …]).
export const listFolders = (prefix) => impl.folders(k(prefix).replace(/\/?$/, "/"));
export const del = (keys) => impl.del((Array.isArray(keys) ? keys : [keys]).map(k));
