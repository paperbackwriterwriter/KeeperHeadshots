// Error alerts by email. Everything the app logs with console.error (which is
// also what Vercel counts as a runtime error) is collected for a short while
// and sent as one summary email, so a problem in production reaches the inbox
// within minutes instead of waiting for someone to open the logs.
//
// - Production only (VERCEL_ENV=production), or anywhere with ALERTS=on.
//   ALERTS=off turns them off.
// - Sent to ALERT_EMAIL (default: the contact inbox) through the site's mailer.
// - At most ALERTS_PER_HOUR emails an hour and ALERTS_PER_DAY a day across all
//   servers (shared counters), so alerts can't use up the email plan's daily
//   allowance that sign-ups rely on; errors past that are still in the logs.

import { waitUntil } from "@vercel/functions";
import { mailEnabled, sendMail, MAIL_FROM } from "./mail.js";
import { overLimit, DAY_MS } from "./ratelimit.js";

const ALERT_TO = () => process.env.ALERT_EMAIL || process.env.CONTACT_TO || "hello@keeperheadshots.com";
const ALERTS_PER_HOUR = Number(process.env.ALERTS_PER_HOUR || 4);
const ALERTS_PER_DAY = Number(process.env.ALERTS_PER_DAY || 10);
// How long to keep collecting after the first error before sending.
const GATHER_MS = Number(process.env.ALERT_GATHER_MS || 20_000);
const LOGS_URL = "https://vercel.com/christianswebsites/keeperheadshots/logs?levels=error";

const enabled = () => {
  const flag = (process.env.ALERTS || "").toLowerCase();
  if (flag === "off") return false;
  return (flag === "on" || process.env.VERCEL_ENV === "production") && mailEnabled();
};

const originalError = console.error.bind(console);
let pending = null; // Map of key -> { count, sample, first }
let timer = null;

function describe(args) {
  return args
    .map((a) => (a instanceof Error ? `${a.message}${a.stack ? `\n${a.stack.split("\n").slice(1, 4).join("\n")}` : ""}` : typeof a === "string" ? a : safeJSON(a)))
    .join(" ")
    .slice(0, 1500);
}
function safeJSON(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
// Similar errors share a key: ids, numbers and hex strings are blanked out.
const keyOf = (text) =>
  text
    .split("\n")[0]
    .replace(/\b(?:usr|sht|shot|clm|cs|pi|ch)_[\w-]+/g, "#")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, "0")
    .slice(0, 120);

export function noteError(...args) {
  if (!enabled()) return;
  const text = describe(args);
  pending ??= new Map();
  const key = keyOf(text);
  const entry = pending.get(key);
  if (entry) entry.count++;
  else if (pending.size < 50) pending.set(key, { count: 1, sample: text, first: new Date().toISOString() });
  if (timer) return;
  // One send per burst; waitUntil keeps a serverless instance alive for it.
  timer = new Promise((resolve) => setTimeout(resolve, GATHER_MS)).then(flush);
  try {
    waitUntil(timer);
  } catch {}
}

export async function flush() {
  const batch = pending;
  pending = null;
  timer = null;
  if (!batch?.size) return false;
  try {
    if (await overLimit("alerts", "site", ALERTS_PER_HOUR)) return false;
    if (await overLimit("alerts-day", "site", ALERTS_PER_DAY, DAY_MS)) return false;
    const total = [...batch.values()].reduce((n, e) => n + e.count, 0);
    const lines = [...batch.values()]
      .sort((a, b) => b.count - a.count)
      .map((e) => `${e.count}× (first at ${e.first})\n${e.sample}`);
    await sendMail({
      from: { name: "Keeper Headshots alerts", address: MAIL_FROM },
      to: ALERT_TO(),
      subject: `[Keeper alert] ${total} error${total === 1 ? "" : "s"} on keeperheadshots.com`,
      text: [
        `The site logged ${total} error${total === 1 ? "" : "s"} in the last ${Math.round(GATHER_MS / 1000)} seconds (${batch.size} kind${batch.size === 1 ? "" : "s"}).`,
        "",
        ...lines.flatMap((l) => [l, ""]),
        `Full logs: ${LOGS_URL}`,
        `At most ${ALERTS_PER_HOUR} of these emails are sent an hour and ${ALERTS_PER_DAY} a day; anything past that is only in the logs.`,
      ].join("\n"),
    });
    return true;
  } catch (err) {
    originalError("[alert] couldn't send", err.message);
    return false;
  }
}

// Route console.error (and crashes that never reach it) through noteError.
export function installErrorAlerts() {
  if (console.error.__alerts) return;
  const wrapped = (...args) => {
    originalError(...args);
    try {
      noteError(...args);
    } catch {}
  };
  wrapped.__alerts = true;
  console.error = wrapped;
  process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
}
