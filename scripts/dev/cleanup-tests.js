// DEV/QA ONLY — checks the daily clean-up (lib/cleanup.js) against a
// throwaway local store: what it deletes, what it keeps, and that a run cut
// short by its time budget resumes where it stopped.
//   node scripts/dev/cleanup-tests.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-cleanup-"));
process.env.DATA_DIR = dir;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;
const storage = await import("../../lib/storage.js");
const { shoots, saveMedia } = await import("../../lib/store.js");
const { runCleanup } = await import("../../lib/cleanup.js");

const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const exists = async (sid) => !!(await shoots.getMeta(sid));

async function shoot(sid, { days, developed = false, sample = false }) {
  const meta = { id: sid, userId: "usr_test", name: sid, status: developed ? "done" : "checked", createdAt: ago(days), selfies: [], shots: developed ? [{ id: "shot_a", lookId: "x", backdrop: "studio-gray", outfit: "navy-suit", take: 0 }] : [], ...(sample ? { sample: true } : {}) };
  await shoots.create(meta);
  // saveMeta stamps updatedAt with "now"; set the real last-change time.
  await storage.putJSON(`shoots/${sid}.json`, { ...(await shoots.getMeta(sid)), updatedAt: ago(days) });
  meta.selfies.push({ file: await saveMedia(sid, Buffer.from("x"), "jpg") });
}

await shoot("sht_oldDraft01", { days: 120 });
await shoot("sht_newDraft01", { days: 10 });
await shoot("sht_oldDone001", { days: 200, developed: true });
await shoot("sht_oldSample1", { days: 300, sample: true });
await saveMedia("sht_orphan0001", Buffer.from("x"), "jpg"); // files with no shoot
await storage.putJSON(`contact/${ago(400).replace(/[:.]/g, "-")}-aaaa.json`, { old: true });
await storage.putJSON(`contact/${ago(5).replace(/[:.]/g, "-")}-bbbb.json`, { old: false });
await storage.putJSON(`ratelimit/contact/abc/${ago(3).slice(0, 13)}.json`, { n: 1 });
await storage.putJSON(`ratelimit/contact/abc/${new Date().toISOString().slice(0, 13)}.json`, { n: 1 });

const r = await runCleanup();
ok("old undeveloped draft deleted, with its photos", !(await exists("sht_oldDraft01")) && (await storage.list("media/sht_oldDraft01/")).length === 0, JSON.stringify(r));
ok("recent draft kept", await exists("sht_newDraft01"));
ok("old developed shoot kept", await exists("sht_oldDone001"));
ok("sample shoot kept", await exists("sht_oldSample1"));
ok("orphaned files deleted", (await storage.list("media/sht_orphan0001/")).length === 0 && r.orphanShoots === 1);
ok("old contact message deleted, recent kept", (await storage.list("contact/")).length === 1 && r.contactDeleted === 1);
ok("old rate-limit counter deleted, current kept", (await storage.list("ratelimit/")).length === 1 && r.rateLimitDeleted === 1);
ok("full run reports finished", r.finished === true);

// A run out of time stops early and the next one resumes.
for (let i = 0; i < 30; i++) await shoot(`sht_bulk${String(i).padStart(4, "0")}`, { days: 100 });
const cut = await runCleanup({ budgetMs: -1 }); // deadline already passed: stops after the first batch
const state = await storage.getJSON("cron/cleanup-state.json");
const rest = await runCleanup();
const left = (await storage.list("shoots/")).filter((k) => k.includes("sht_bulk")).length;
ok("a run out of time stops early and saves its place", cut.finished === false && !!state.drafts, `deleted=${cut.draftsDeleted} cursor=${state.drafts}`);
ok("the next run finishes the rest", left === 0 && rest.finished === true, `left=${left} deleted=${rest.draftsDeleted}`);

fs.rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
