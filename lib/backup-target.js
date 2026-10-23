// Private backup storage, shared by records, photos and erasure safeguards.
import { list, listPage, getFile, putFile, del, NAMESPACE } from "./storage.js";

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
  async put(key, buf, contentType = "application/gzip") {
    const a = await auth();
    if (!a) return putFile(key, buf, contentType);
    const { put } = await sdk();
    await put(key, buf, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType, ...a });
  },
  async get(key) {
    const a = await auth();
    if (!a) return getFile(key);
    const { get } = await sdk();
    // Like the main store's reads (lib/storage.js): a 5xx or 429 is retried once.
    const read = () => get(key, { access: "private", useCache: false, ...a });
    const res = await read().catch(async (err) => {
      const msg = String(err?.message);
      const limited = /\b429\b|rate.?limit|too many requests/i.test(msg);
      if (!limited && !/\b5\d\d\b/.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, (limited ? 600 : 150) + Math.random() * (limited ? 600 : 250)));
      return read();
    });
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
  async listPage(prefix, cursor = null) {
    const a = await auth();
    if (!a) return listPage(prefix, cursor);
    const { list: blobList } = await sdk();
    const page = await blobList({ prefix, cursor: cursor || undefined, limit: 1000, ...a });
    return { keys: page.blobs.map((b) => b.pathname), cursor: page.hasMore ? page.cursor : null };
  },
  async del(keys) {
    if (!keys.length) return;
    const a = await auth();
    if (!a) return del(keys);
    const { del: blobDel } = await sdk();
    for (let i = 0; i < keys.length; i += 100) await blobDel(keys.slice(i, i + 100), a);
  },
};

export const mainTarget = { list, listPage, get: getFile, put: putFile, del };
export const usesSeparate = () => target.separate() && !NAMESPACE;
export const backupTargets = () => usesSeparate() ? [mainTarget, target] : [mainTarget];
