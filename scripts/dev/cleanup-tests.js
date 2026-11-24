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
const { INVITE_TTL_DAYS, markSent } = await import("../../lib/teams.js");
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
// A team with one invitation past its 90 days and one fresh.
await storage.putJSON("users/id/usr_teamadm.json", { id: "usr_teamadm", email: "adm@x.com", credits: 0 });
await storage.putJSON("teams/tm_clean1.json", { id: "tm_clean1", ownerId: "usr_teamadm", ownerName: "Adm", name: "Cleaners", looks: [], invites: {
  inv_old: { id: "inv_old", email: "old@x.com", token: "tokOLDtokOLDtokOLDtokOLD", status: "invited", invitedAt: ago(INVITE_TTL_DAYS + 5), sentAt: null, charged: true },
  inv_new: { id: "inv_new", email: "new@x.com", token: "tokNEWtokNEWtokNEWtokNEW", status: "invited", invitedAt: ago(5), sentAt: null, charged: true },
} });
await storage.putJSON("invites/tokOLDtokOLDtokOLDtokOLD.json", { teamId: "tm_clean1", inviteId: "inv_old" });
await storage.putJSON("invites/tokNEWtokNEWtokNEWtokNEW.json", { teamId: "tm_clean1", inviteId: "inv_new" });

// A shoot whose render worker died with nobody polling the page.
await shoots.create({ id: "sht_stuckGen01", userId: "usr_test", name: "stuck", status: "generating", createdAt: ago(1), selfies: [], shots: [{ id: "shot_s1", lookId: "x", backdrop: "studio-gray", outfit: "navy-suit", take: 0 }] });
await storage.putJSON("shots/sht_stuckGen01/shot_s1.json", { id: "shot_s1", lookId: "x", backdrop: "studio-gray", outfit: "navy-suit", take: 0, status: "rendering", startedAt: ago(1), claim: "dead-worker" });
await storage.putJSON("shoots/sht_stuckGen01.json", { ...(await shoots.getMeta("sht_stuckGen01")), updatedAt: ago(1) });

const r = await runCleanup();
{
  const stuck = await shoots.getMeta("sht_stuckGen01");
  ok("a shoot left 'generating' by a dead worker is moved on", stuck && stuck.status !== "generating" && r.stuckAdvanced === 1, `${stuck?.status} advanced=${r.stuckAdvanced}`);
}
ok("old undeveloped draft deleted, with its photos", !(await exists("sht_oldDraft01")) && (await storage.list("media/sht_oldDraft01/")).length === 0, JSON.stringify(r));
ok("recent draft kept", await exists("sht_newDraft01"));
ok("old developed shoot kept", await exists("sht_oldDone001"));
ok("sample shoot kept", await exists("sht_oldSample1"));
ok("orphaned files deleted", (await storage.list("media/sht_orphan0001/")).length === 0 && r.orphanShoots === 1);
ok("old contact message deleted, recent kept", (await storage.list("contact/")).length === 1 && r.contactDeleted === 1);
ok("old rate-limit counter deleted, current kept", (await storage.list("ratelimit/")).length === 1 && r.rateLimitDeleted === 1);
ok("full run reports finished", r.finished === true);
{
  const team = await storage.getJSON("teams/tm_clean1.json");
  const adm = await storage.getJSON("users/id/usr_teamadm.json");
  await markSent("tm_clean1", "inv_new");
  const resent = (await storage.getJSON("teams/tm_clean1.json")).invites.inv_new;
  ok("resending an invitation restarts its 90 days", Date.now() - Date.parse(resent.invitedAt) < 60_000 && resent.sentAt === resent.invitedAt);
  ok("an invitation older than 90 days lapses and gives the shoot back", r.invitesExpired === 1 && team.invites.inv_old.status === "expired" && team.invites.inv_new.status === "invited" && adm.credits === 1 && !(await storage.getJSON("invites/tokOLDtokOLDtokOLDtokOLD.json")) && !!(await storage.getJSON("invites/tokNEWtokNEWtokNEWtokNEW.json")), JSON.stringify({ expired: r.invitesExpired, credits: adm.credits }));
}

// A run out of time stops early and the next one resumes.
for (let i = 0; i < 30; i++) await shoot(`sht_bulk${String(i).padStart(4, "0")}`, { days: 100 });
const cut = await runCleanup({ budgetMs: -1 }); // deadline already passed: stops after the first batch
const state = await storage.getJSON("cron/cleanup-state.json");
const rest = await runCleanup();
const left = (await storage.list("shoots/")).filter((k) => k.includes("sht_bulk")).length;
ok("a run out of time stops early and saves its place", cut.finished === false && !!state.drafts, `deleted=${cut.draftsDeleted} cursor=${state.drafts}`);
ok("the next run finishes the rest", left === 0 && rest.finished === true, `left=${left} deleted=${rest.draftsDeleted}`);

// A damaged record is skipped (and counted) without stopping the run.
fs.mkdirSync(path.join(dir, "shoots"), { recursive: true });
fs.writeFileSync(path.join(dir, "shoots", "sht_aaBroken01.json"), "{not json");
await shoot("sht_zzOldDraft", { days: 150 });
const bad = await runCleanup();
ok("a damaged record doesn't stop the run", bad.errors >= 1 && bad.finished === true && !(await exists("sht_zzOldDraft")), `errors=${bad.errors}`);

// A step whose storage call times out (G17-6) is reported and skipped; the
// steps before and after it still run, and the run doesn't throw.
{
  const fsp = (await import("node:fs/promises")).default;
  const realReaddir = fsp.readdir;
  await shoot("sht_zzOldDraft2", { days: 150 });
  await storage.putJSON(`contact/${ago(500).replace(/[:.]/g, "-")}-cccc.json`, { old: true });
  await storage.putJSON(`ratelimit/contact/def/${ago(4).slice(0, 13)}.json`, { n: 1 });
  fsp.readdir = async (d, ...rest) => {
    if (String(d).endsWith(`${path.sep}shots`) || String(d).endsWith(`${path.sep}contact`)) throw new storage.StorageTimeoutError("list", d, 20000);
    return realReaddir(d, ...rest);
  };
  const before = await storage.getJSON("cron/cleanup-state.json");
  let timed, threw = null;
  try {
    timed = await runCleanup();
  } catch (err) {
    threw = err;
  } finally {
    fsp.readdir = realReaddir;
  }
  ok("a timed-out listing doesn't throw out of the clean-up", !threw && !!timed, threw?.message);
  ok("the failed steps are named in the report and counted", JSON.stringify(timed?.failedSteps) === JSON.stringify(["orphaned files", "contact messages"]) && timed.errors >= 2 && timed.finished === false, JSON.stringify(timed));
  ok("the other steps still run (drafts, rate-limit counters)", !(await exists("sht_zzOldDraft2")) && timed?.rateLimitDeleted === 1 && (await storage.list("contact/")).length === 2, JSON.stringify(timed));
  ok("a failed listing keeps its saved place", (await storage.getJSON("cron/cleanup-state.json"))?.orphans === (before?.orphans ?? null));
}

// A20-1: an account deletion that stopped partway (a storage time-out after
// the marker) is finished by the clean-up once it's 10 minutes old; a
// deletion still running, and accounts without a marker, are left alone.
{
  const crypto = await import("node:crypto");
  const { users } = await import("../../lib/store.js");
  const { currentUser, setSession } = await import("../../lib/auth.js");
  const fsp = (await import("node:fs/promises")).default;
  const STUCK_MS = 10 * 60 * 1000;
  const marker = (uid) => storage.getJSON(`cancelled/users/${uid}.json`);
  const age = async (uid, ms) => storage.putJSON(`cancelled/users/${uid}.json`, { ...(await marker(uid)), at: new Date(Date.now() - ms).toISOString() });
  const hash = (email) => crypto.createHash("sha256").update(email).digest("hex");
  const signedIn = (user) => {
    const jar = {};
    setSession({ cookie: (n, v) => (jar[n] = v) }, user);
    return currentUser({ cookies: jar });
  };
  async function account(uid, email) {
    const u = await users.create({ id: uid, email, name: uid, createdAt: ago(30), usage: { checks: 1 } });
    const sid = `sht_${uid.slice(4)}01`;
    await shoots.create({ id: sid, userId: uid, name: "mine", status: "done", createdAt: ago(5), selfies: [], shots: [{ id: "shot_d1", lookId: "x", backdrop: "studio-gray", outfit: "navy-suit", take: 0 }] });
    await saveMedia(sid, Buffer.from("x"), "jpg");
    await storage.putJSON(`reviews/${uid}.json`, { userId: uid, rating: 5, text: "Great", status: "pending" });
    return u;
  }
  const gone = await account("usr_zzDelStop1", "stop@example.com");
  const kept = await account("usr_zzDelKeep1", "keep@example.com");
  const sid = "sht_zzDelStop101";
  // POST /api/account/delete stops partway: a storage time-out removing the
  // shoot, after the marker was written. (On the old code the marker is
  // written straight from the route, so simulate it the same way there.)
  const realRm = fsp.rm;
  let thrown = 0;
  fsp.rm = async (p, ...rest) => {
    if (!thrown && String(p) === path.join(dir, "shoots", `${sid}.json`)) {
      thrown++;
      throw new storage.StorageTimeoutError("del", p, 20000);
    }
    return realRm(p, ...rest);
  };
  let stopped = null;
  try {
    await users.beginRemoval(gone.id);
    await users.remove(gone);
  } catch (err) {
    stopped = err;
  } finally {
    fsp.rm = realRm;
  }
  const m0 = await marker(gone.id);
  ok("deletion: a time-out stops it after the marker (setup)", stopped instanceof storage.StorageTimeoutError && m0 && !m0.erased && !!(await users.byId(gone.id)) && !!(await signedIn(gone)), stopped?.message);

  const fresh = await runCleanup();
  ok("deletion: one started under 10 minutes ago is left alone", !fresh.deletionsFinished && !!(await users.byId(gone.id)) && !(await marker(gone.id)).erased, JSON.stringify(fresh));

  await age(gone.id, STUCK_MS + 60_000);
  const startedAt = (await marker(gone.id)).at;
  const done = await runCleanup();
  const m1 = await marker(gone.id);
  ok("deletion: the clean-up finishes one that stopped", done.deletionsFinished === 1 && !(done.failedSteps || []).length, JSON.stringify(done));
  ok("deletion: account record and email index gone", !(await users.byId(gone.id)) && !(await storage.getJSON(`users/email/${hash("stop@example.com")}.json`)) && !(await users.byEmail("stop@example.com")));
  ok("deletion: shoots, photos and review gone", !(await shoots.getMeta(sid)) && (await storage.list(`idx/${gone.id}/`)).length === 0 && (await storage.list(`media/${sid}/`)).length === 0 && !(await storage.getJSON(`reviews/${gone.id}.json`)));
  ok("deletion: marker marked finished, start time kept", m1?.cancelled === true && m1.erased === true && m1.at === startedAt && !!m1.erasedAt, JSON.stringify(m1));
  ok("deletion: the session is signed out (/api/me)", !(await signedIn(gone)));
  ok("deletion: free usage kept under the email hash, as the route does", !!(await storage.getJSON(`users/deleted/${hash("stop@example.com")}.json`)));

  const again = await runCleanup();
  ok("deletion: running the clean-up again is harmless", again.deletionsFinished === 0 && !(again.failedSteps || []).length && JSON.stringify(await marker(gone.id)) === JSON.stringify(m1), JSON.stringify(again));
  let twice = null;
  try {
    const { finishDeletion } = await import("../../lib/account-deletion.js");
    await finishDeletion(gone.id);
  } catch (err) {
    twice = err;
  }
  ok("deletion: finishing an already finished deletion is harmless", !twice && (await marker(gone.id))?.erased === true && !(await users.byId(gone.id)), twice?.message);

  ok("deletion: an account without a marker is untouched", !!(await users.byId(kept.id)) && !(await marker(kept.id)) && !!(await shoots.getMeta("sht_zzDelKeep101")) && !!(await storage.getJSON(`reviews/${kept.id}.json`)) && !!(await signedIn(kept)));

  // A marker from before markers recorded a start time counts as old; one
  // whose account record had already gone is still finished and marked.
  await storage.putJSON("cancelled/users/usr_zzDelOld01.json", { cancelled: true });
  await storage.putJSON("deletions/pending/usr_zzDelOld01.json", {});
  await storage.putJSON("idx/usr_zzDelOld01/sht_zzDelOld0101", {});
  const legacy = await runCleanup();
  const m2 = await marker("usr_zzDelOld01");
  ok("deletion: an old marker without a start time (no account record) is finished", legacy.deletionsFinished === 1 && m2?.erased === true && (await storage.list("idx/usr_zzDelOld01/")).length === 0, JSON.stringify({ legacy, m2 }));
  ok("deletion: a finished deletion leaves nothing pending", (await storage.list("deletions/pending/")).length === 0, JSON.stringify(await storage.list("deletions/pending/")));

  // 23 Nov (owner): the shoots cron checks every 10 minutes, from the pending
  // list, so "within a day" always holds.
  const { finishStuckDeletions } = await import("../../lib/cleanup.js");
  const late = await account("usr_zzDelLate1", "late@example.com");
  const lateSid = "sht_zzDelLate101";
  thrown = 0;
  fsp.rm = async (p, ...rest) => {
    if (!thrown && String(p) === path.join(dir, "shoots", `${lateSid}.json`)) {
      thrown++;
      throw new storage.StorageTimeoutError("del", p, 20000);
    }
    return realRm(p, ...rest);
  };
  try { await users.remove(late); } catch {} finally { fsp.rm = realRm; }
  ok("deletion: a deletion that stopped is listed as pending", !!(await storage.getJSON("deletions/pending/usr_zzDelLate1.json")) && !(await marker(late.id)).erased);
  const early = await finishStuckDeletions();
  ok("deletion: the 10-minute check leaves one under 10 minutes old", early.finished === 0 && !!(await users.byId(late.id)), JSON.stringify(early));
  await age(late.id, STUCK_MS + 60_000);
  const reads = [];
  const realRead = fsp.readFile;
  fsp.readFile = async (p, ...rest) => (reads.push(String(p)), realRead(p, ...rest));
  let quick;
  try { quick = await finishStuckDeletions(); } finally { fsp.readFile = realRead; }
  ok("deletion: the 10-minute check finishes it", quick.finished === 1 && !(await users.byId(late.id)) && (await marker(late.id))?.erased === true && !(await storage.getJSON("deletions/pending/usr_zzDelLate1.json")), JSON.stringify(quick));
  ok("deletion: the 10-minute check reads only pending deletions' markers", !reads.some((r) => /cancelled\/users\/usr_zzDel(Stop|Old)/.test(r)), reads.filter((r) => r.includes("cancelled/users")).join(" "));
  // A pending entry left behind by a finished deletion is tidied away.
  await storage.putJSON("deletions/pending/usr_zzDelStop1.json", { at: new Date().toISOString() });
  const tidy = await finishStuckDeletions();
  ok("deletion: a stale pending entry is removed, nothing finished twice", tidy.finished === 0 && !(await storage.getJSON("deletions/pending/usr_zzDelStop1.json")), JSON.stringify(tidy));

  // 24 Nov (owner): the daily clean-up reads the pending list, not every
  // marker ever written.
  const nightlyReads = [];
  fsp.readFile = async (p, ...rest) => (nightlyReads.push(String(p)), realRead(p, ...rest));
  let nightly;
  try { nightly = await runCleanup(); } finally { fsp.readFile = realRead; }
  ok("deletion: the daily clean-up doesn't read finished deletions' markers", nightly.deletionsFinished === 0 && !nightlyReads.some((r) => /cancelled\/users\/usr_zzDel(Stop|Old|Late)/.test(r)), nightlyReads.filter((r) => r.includes("cancelled/users/")).join(" "));
}

fs.rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
