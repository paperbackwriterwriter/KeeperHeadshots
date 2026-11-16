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
    const tail = prev.then(() => mine);
    fsLocks.set(key, tail);
    await prev;
    let unlock;
    try {
      unlock = await lockFile(abs(key) + ".lock");
      const buf = await this.getBuffer(key);
      if (!buf) return null;
      const value = JSON.parse(buf.toString("utf8"));
      const next = fn(value);
      if (next === UNCHANGED) return value;
      await this.put(key, JSON.stringify(next));
      return next;
    } finally {
      try { if (unlock) await unlock(); }
      finally {
        release();
        if (fsLocks.get(key) === tail) fsLocks.delete(key);
      }
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
  // One page of list(prefix), in key order, resuming after `cursor`.
  async listPage(prefix, cursor) {
    const size = Math.max(1, Number(process.env.STORAGE_LIST_PAGE) || 1000);
    const keys = (await this.list(prefix)).sort().filter((key) => !cursor || key > cursor).slice(0, size + 1);
    return { keys: keys.slice(0, size), cursor: keys.length > size ? keys[size - 1] : null };
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

// A conditional write that lost to another write: the ETag no longer matches
// (412), or Blob reports the two writes overlapping ("The conditional request
// cannot succeed due to a conflicting operation against this resource.",
// which the SDK passes on as a plain BlobError). Either way, read and retry.
export const isWriteConflict = (err, PreconditionFailed) => (!!PreconditionFailed && err instanceof PreconditionFailed) || /conflicting operation/i.test(err?.message || "");

// A unique run of whitespace after a conditional write's JSON (JSON.parse
// ignores it). After a reported conflict, finding this exact text means our
// own write landed; another writer that saved the same value (two requests
// adding 1 to the same counter) has a different mark, so ours is retried.
const writeMark = () => "\n" + Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(2).padStart(32, "0")).join("").replace(/0/g, " ").replace(/1/g, "\t");

// Time limits. Every Blob call (and reading a download's body) is cut off
// after STORAGE_TIMEOUT_MS (20 s), so a call that hangs, or the SDK's own
// retries with growing pauses (up to 10 of them), fails the request in
// seconds instead of holding it until the 300 s function limit. A body gets
// one more second per MB on top (photos are under a few MB; a nightly backup
// can be tens of MB), up to 2 minutes. Reads are retried once after a time-out;
// writes aren't (a cut-off write may still land), they fail with a 503.
const limitMs = () => Number(process.env.STORAGE_TIMEOUT_MS) || 20_000;
const limitFor = (bytes) => Math.min(120_000, limitMs() + Math.round((bytes || 0) / 1_000));
export class StorageTimeoutError extends Error {
  constructor(what, key, ms) {
    super("That's taking longer than usual. Please try again.");
    Object.assign(this, { name: "StorageTimeoutError", status: 503, code: "storage_timeout", detail: `${what} ${key} after ${ms} ms` });
  }
}
// Runs fn(abortSignal, extend) and rejects with StorageTimeoutError if it
// takes longer than ms; extend(ms) restarts the clock (for a body whose size
// is known once the response starts). The signal is aborted plainly (an
// AbortError, which the SDK gives up on; AbortSignal.timeout's TimeoutError
// would be retried by it), and the race rejects even if fn ignores it.
async function timed(what, key, ms, fn) {
  const ac = new AbortController();
  let timer, fail;
  const expired = new Promise((_, reject) => (fail = reject));
  const arm = (t) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.error("[storage] timed out:", what, key, `${t} ms`);
      fail(new StorageTimeoutError(what, key, t));
      ac.abort();
    }, t);
  };
  arm(ms);
  try {
    return await Promise.race([fn(ac.signal, arm), expired]);
  } finally {
    clearTimeout(timer);
  }
}
const retryTimeout = (fn) => fn().catch((err) => {
  if (!(err instanceof StorageTimeoutError)) throw err;
  return fn();
});

// One download, body included, under one time limit: the content, or null if
// there's no such blob.
const download = (get, key, headers) =>
  timed("read", key, limitMs(), async (abortSignal, extend) => {
    const res = await get(key, { access: "private", useCache: false, ...(headers ? { headers } : {}), abortSignal });
    if (!res || res.statusCode !== 200) return null;
    extend(limitFor(res.blob?.size));
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  });

const blobStore = {
  async getBuffer(key) {
    const { get } = await sdk();
    // useCache:false — this is live app state, never serve a stale copy.
    // Blob now and then answers a read with a 5xx, or a 429 when it's
    // briefly rate-limiting, or doesn't answer at all; a read is safe to
    // repeat, so retry once (after a pause for a 5xx, a longer one for a 429)
    // before failing the request.
    return download(get, key).catch(async (err) => {
      if (err instanceof StorageTimeoutError) return download(get, key);
      const msg = String(err?.message);
      const limited = /\b429\b|rate.?limit|too many requests/i.test(msg) || err?.name === "BlobServiceRateLimited";
      if (!limited && !/\b5\d\d\b/.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, (limited ? 600 : 150) + Math.random() * (limited ? 600 : 250)));
      return download(get, key);
    });
  },
  async put(key, body, contentType) {
    const { put } = await sdk();
    await timed("write", key, limitFor(Buffer.byteLength(body)), (abortSignal) => put(key, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 60, abortSignal }));
  },
  async create(key, body, contentType) {
    const { put, head } = await sdk();
    try {
      // Without allowOverwrite, Blob refuses to replace an existing blob.
      await timed("write", key, limitFor(Buffer.byteLength(body)), (abortSignal) => put(key, body, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType, abortSignal }));
      return true;
    } catch (err) {
      if (await timed("head", key, limitMs(), (abortSignal) => head(key, { abortSignal })).then(() => true, () => false)) return false;
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
        meta = await retryTimeout(() => timed("head", key, limitMs(), (abortSignal) => head(key, { abortSignal })));
      } catch (err) {
        if (BlobNotFoundError && err instanceof BlobNotFoundError) return null;
        throw err;
      }
      const buf = await retryTimeout(() => download(get, key, { "accept-encoding": "identity" }));
      if (!buf) return null;
      const value = JSON.parse(buf.toString("utf8"));
      const next = fn(value);
      if (next === UNCHANGED) return value;
      const written = JSON.stringify(next) + writeMark();
      try {
        await timed("write", key, limitFor(Buffer.byteLength(written)), (abortSignal) => put(key, written, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60, ifMatch: meta.etag, abortSignal }));
        return next;
      } catch (err) {
        if (!isWriteConflict(err, BlobPreconditionFailedError)) throw err;
        // A write can land and still report a conflict (the SDK retries a
        // request whose answer was lost, and the retry then finds its own
        // write). If the record now holds exactly what we wrote, mark and
        // all, it's done: running fn again would apply the change twice.
        const now = await download(get, key, { "accept-encoding": "identity" }).then((b) => (b ? b.toString("utf8") : null), () => null);
        if (now === written) return next;
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
      const page = await retryTimeout(() => timed("list", prefix, limitMs(), (abortSignal) => list({ prefix, cursor, limit: 1000, abortSignal })));
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  // One page of list(prefix); `cursor` comes from the previous page.
  async listPage(prefix, cursor) {
    const { list } = await sdk();
    const page = await retryTimeout(() => timed("list", prefix, limitMs(), (abortSignal) => list({ prefix, cursor: cursor || undefined, limit: 1000, abortSignal })));
    return { keys: page.blobs.map((b) => b.pathname), cursor: page.hasMore ? page.cursor : null };
  },
  // Names of the folders directly under prefix, without listing their files.
  async folders(prefix) {
    const { list } = await sdk();
    const out = [];
    let cursor;
    do {
      const page = await retryTimeout(() => timed("list", prefix, limitMs(), (abortSignal) => list({ prefix, cursor, limit: 1000, mode: "folded", abortSignal })));
      out.push(...page.folders.map((f) => f.slice(prefix.length).replace(/\/$/, "")));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  },
  async del(keys) {
    if (!keys.length) return;
    const { del } = await sdk();
    for (let i = 0; i < keys.length; i += 100) await timed("delete", keys[i], limitMs(), (abortSignal) => del(keys.slice(i, i + 100), { abortSignal }));
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
export const listPage = async (prefix, cursor = null) => {
  const page = await impl.listPage(k(prefix), cursor);
  return { keys: page.keys.map(unk), cursor: page.cursor };
};
// Folder names directly under prefix ("media/" -> ["sht_…", …]).
export const listFolders = (prefix) => impl.folders(k(prefix).replace(/\/?$/, "/"));
export const del = (keys) => impl.del((Array.isArray(keys) ? keys : [keys]).map(k));
