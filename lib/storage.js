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
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
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
  async list(prefix) {
    const dir = abs(prefix.replace(/\/$/, "") || ".");
    try {
      const names = await fs.readdir(dir);
      return names.filter((n) => !n.endsWith(".tmp")).map((n) => `${prefix.replace(/\/?$/, "/")}${n}`);
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
    const res = await get(key, { access: "private", useCache: false });
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
  async del(keys) {
    if (!keys.length) return;
    const { del } = await sdk();
    for (let i = 0; i < keys.length; i += 100) await del(keys.slice(i, i + 100));
  },
};

const impl = useBlob ? blobStore : fsStore;

export async function getJSON(key) {
  const buf = await impl.getBuffer(key);
  return buf ? JSON.parse(buf.toString("utf8")) : null;
}
export const putJSON = (key, value) => impl.put(key, JSON.stringify(value), "application/json");
// Writes only if the key doesn't exist yet; returns false if it already did.
export const createJSON = (key, value) => impl.create(key, JSON.stringify(value), "application/json");
export const getFile = (key) => impl.getBuffer(key);
export const putFile = (key, buf, contentType) => impl.put(key, buf, contentType);
export const list = (prefix) => impl.list(prefix);
export const del = (keys) => impl.del(Array.isArray(keys) ? keys : [keys]);
