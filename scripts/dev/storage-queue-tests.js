// Check actual storage code, exposing only queue size in a temporary copy.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keeper-storage-queues-"));
process.env.DATA_DIR = path.join(dir, "data");
for (const key of ["BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "STORAGE_NAMESPACE"]) delete process.env[key];
const file = path.join(dir, "instrumented-storage.mjs");
await fs.writeFile(file, await fs.readFile(new URL("../../lib/storage.js", import.meta.url), "utf8") + "\nexport const queueSize = () => fsLocks.size;\n");
const s = await import(pathToFileURL(file));
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("PASS", name); };
try {
  await test("completed writes to distinct keys release every queue entry", async () => {
    for (let i = 0; i < 100; i++) { await s.putJSON(`keys/${i}.json`, { n: 0 }); await s.updateJSON(`keys/${i}.json`, (r) => ({ n: r.n + 1 })); }
    assert.equal(s.queueSize(), 0);
  });
  await test("queued writes remain serialized and a predecessor cannot remove the tail", async () => {
    await s.putJSON("counter.json", { n: 0 });
    const writes = Array.from({ length: 40 }, () => s.updateJSON("counter.json", (r) => ({ n: r.n + 1 })));
    await writes[0]; assert.equal(s.queueSize(), 1);
    await Promise.all(writes); assert.equal((await s.getJSON("counter.json")).n, 40); assert.equal(s.queueSize(), 0);
  });
  await test("a rejected callback releases the queue and the next queued write completes", async () => {
    const bad = s.updateJSON("counter.json", () => { throw new Error("callback failed"); });
    const next = s.updateJSON("counter.json", (r) => ({ n: r.n + 1 }));
    await assert.rejects(bad, /callback failed/); await next;
    assert.equal((await s.getJSON("counter.json")).n, 41); assert.equal(s.queueSize(), 0);
  });
  await test("unchanged and missing-record paths release their queues", async () => {
    await s.updateJSON("counter.json", () => s.UNCHANGED);
    assert.equal(await s.updateJSON("missing.json", (r) => r), null); assert.equal(s.queueSize(), 0);
  });
  await test("invalid keys cannot leave a pending queue entry", async () => {
    await assert.rejects(s.updateJSON("../outside.json", (r) => r), /Invalid storage key/); assert.equal(s.queueSize(), 0);
  });
  await test("failure to create a filesystem lock releases the queue for a later retry", async () => {
    await s.putFile("blocked", Buffer.from("not-a-directory"));
    await assert.rejects(s.updateJSON("blocked/key.json", (r) => r)); assert.equal(s.queueSize(), 0);
    await s.del("blocked"); await s.putJSON("blocked/key.json", { n: 0 });
    await s.updateJSON("blocked/key.json", (r) => ({ n: r.n + 1 })); assert.equal(s.queueSize(), 0);
  });
  await test("corrupt record errors release the queue without blocking repaired data", async () => {
    await s.putFile("corrupt.json", Buffer.from("{bad-json"));
    await assert.rejects(s.updateJSON("corrupt.json", (r) => r), SyntaxError); assert.equal(s.queueSize(), 0);
    await s.putJSON("corrupt.json", { n: 0 }); await s.updateJSON("corrupt.json", (r) => ({ n: r.n + 1 })); assert.equal(s.queueSize(), 0);
  });
  await test("a Blob write that overlaps another (conflicting operation) is read again and retried", async () => {
    // A copy on the Blob backend, with a stand-in for the Blob service.
    const blobFile = path.join(dir, "blob-storage.mjs");
    await fs.writeFile(blobFile, (await fs.readFile(new URL("../../lib/storage.js", import.meta.url), "utf8")).replace("const useBlob = ", "const useBlob = true || ") + "\nexport const setSdk = (x) => (blobSdk = x);\n");
    const b = await import(pathToFileURL(blobFile));
    class BlobPreconditionFailedError extends Error {}
    let stored = { n: 1 }, etag = 1, puts = 0;
    b.setSdk({
      BlobPreconditionFailedError, BlobNotFoundError: class extends Error {},
      head: async () => ({ etag: String(etag) }),
      get: async () => ({ statusCode: 200, stream: new Blob([JSON.stringify(stored)]).stream() }),
      put: async (key, body) => {
        if (++puts === 1) { stored = { n: 10 }; etag++; throw new Error("Vercel Blob: The conditional request cannot succeed due to a conflicting operation against this resource."); }
        stored = JSON.parse(body); etag++;
      },
    });
    const out = await b.updateJSON("shoots/sht_x.json", (r) => ({ n: r.n + 1 }));
    assert.equal(puts, 2); assert.deepEqual(out, { n: 11 }); assert.deepEqual(stored, { n: 11 });
    // A write that landed but still reported a conflict (an SDK retry finding
    // its own write) isn't applied a second time.
    for (const message of ["Vercel Blob: The conditional request cannot succeed due to a conflicting operation against this resource.", "precondition"]) {
      stored = { credits: 5 }; puts = 0;
      b.setSdk({
        BlobPreconditionFailedError, BlobNotFoundError: class extends Error {},
        head: async () => ({ etag: String(etag) }),
        get: async () => ({ statusCode: 200, stream: new Blob([JSON.stringify(stored)]).stream() }),
        put: async (key, body) => { puts++; stored = JSON.parse(body); etag++; throw message === "precondition" ? new BlobPreconditionFailedError() : new Error(message); },
      });
      const r = await b.updateJSON("users/id/usr_x.json", (u) => ({ ...u, credits: u.credits - 1 }));
      assert.equal(puts, 1, message); assert.deepEqual(stored, { credits: 4 }); assert.deepEqual(r, { credits: 4 });
    }
  });
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`\n${passed}/${passed} passed`);
