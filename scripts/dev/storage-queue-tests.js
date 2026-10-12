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
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`\n${passed}/${passed} passed`);
