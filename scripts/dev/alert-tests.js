// DEV/QA ONLY — checks the error alert emails (lib/alert.js) in-process, with
// mail going to scripts/dev/mock-ai.js (must be running on :4010) and a
// throwaway local store for the hourly cap.
//   node scripts/dev/alert-tests.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-alerts-"));
const M = process.env.MOCK || "http://localhost:4010";
const to = `alerts${Date.now()}@example.com`;
Object.assign(process.env, { DATA_DIR: dir, ALERTS: "on", ALERT_EMAIL: to, ALERT_GATHER_MS: "300", ALERTS_PER_HOUR: "2", ALERTS_PER_DAY: "10", RESEND_API_KEY: "re_test", RESEND_BASE_URL: M });
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.SMTP_PASS;
const { installErrorAlerts } = await import("../../lib/alert.js");
installErrorAlerts();

const results = [];
const ok = (name, cond, extra = "") => (results.push(!!cond), console.log(cond ? "PASS" : "FAIL", name, extra));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = async () => (await fetch(`${M}/mock-mail`).then((r) => r.json())).filter((m) => m.to.includes(to));

// A burst of errors becomes one email, with similar ones grouped.
console.error("[render] failed for shot_abc123", new Error("boom 1"));
console.error("[render] failed for shot_def456", new Error("boom 2"));
console.error("[billing] something else");
await wait(900);
let mail = await sent();
ok("a burst of errors sends one summary email", mail.length === 1 && /3 errors/.test(mail[0].subject), mail.map((m) => m.subject).join(" | "));

// Node's own warnings (printed as errors) don't send an alert.
console.error("(node:4) ExperimentalWarning: vm.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature and might change at any time");
console.error("(node:4) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.");
await wait(900);
mail = await sent();
ok("Node warnings don't send an alert", mail.length === 1, `${mail.length} emails`);

// The hourly cap (2 here) holds: a third burst isn't emailed.
console.error("second burst");
await wait(900);
console.error("third burst");
await wait(900);
mail = await sent();
ok("no more than the hourly cap", mail.length === 2, `${mail.length} emails`);

// ALERTS=off turns them off.
process.env.ALERTS = "off";
fs.rmSync(path.join(dir, "ratelimit"), { recursive: true, force: true });
console.error("while off");
await wait(900);
ok("ALERTS=off sends nothing", (await sent()).length === 2);

fs.rmSync(dir, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
