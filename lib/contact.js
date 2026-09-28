// Contact form: every message is saved to storage first, then emailed to the
// team inbox through SMTP (ImprovMX) with Reply-To set to the sender, so a
// plain "Reply" in Gmail answers the customer.

import crypto from "node:crypto";
import { putJSON } from "./storage.js";
import { overLimit, HOUR_MS } from "./ratelimit.js";
import { MAIL_FROM, mailEnabled, sendMail } from "./mail.js";

export const CONTACT_TO = process.env.CONTACT_TO || "hello@keeperheadshots.com";

// Kept in sync with TOPICS in public/js/views/contact.js.
export const TOPICS = {
  general: "General question",
  shoot: "Help with a shoot",
  billing: "Billing or refunds",
  team: "Team headshots",
  press: "Press or partnerships",
};

export const contactEnabled = mailEnabled;

const clean = (s, max) => String(s ?? "").replace(/\r/g, "").trim().slice(0, max);
const oneLine = (s, max) => clean(s, max).replace(/\s+/g, " ");

export function validate(body) {
  const msg = {
    name: oneLine(body?.name, 80),
    email: oneLine(body?.email, 200).toLowerCase(),
    topic: TOPICS[body?.topic] ? body.topic : "general",
    message: clean(body?.message, 5000),
  };
  const fields = {};
  if (msg.name.length < 2) fields.name = "Tell us what to call you.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.email)) fields.email = "Enter a valid email address so we can reply.";
  if (msg.message.length < 10) fields.message = "Add a little more detail (at least 10 characters).";
  return { msg, fields };
}

// At most `limit` messages per address per clock hour, counted in storage so
// every server instance shares the count (lib/ratelimit.js). This instance's
// own count is checked first, so a flood from one address is turned away
// without a storage write each time; if storage can't be reached, that count
// stands in rather than blocking real messages.
const recent = new Map();
function localLimited(ip, limit, windowMs) {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > limit;
}
export async function rateLimited(ip, limit = 5) {
  if (localLimited(ip, limit, HOUR_MS)) return true;
  try {
    return await overLimit("contact", ip, limit);
  } catch (err) {
    console.warn("[contact] shared rate limit unavailable:", err.message);
    return false;
  }
}

export async function submit(msg, { user, ip } = {}) {
  const at = new Date().toISOString();
  const id = `${at.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
  const record = { id, at, ...msg, topicLabel: TOPICS[msg.topic], account: user ? { id: user.id, email: user.email } : null, ip, emailed: false };
  // The stored copy is a backup; the email is what reaches us. A storage
  // problem is logged but doesn't stop the message from being sent.
  const save = (r) => putJSON(`contact/${id}.json`, r).catch((err) => console.error("[contact] couldn't store a copy", id, err.message));
  await save(record);

  const lines = [
    `From: ${msg.name} <${msg.email}>`,
    `Topic: ${TOPICS[msg.topic]}`,
    user ? `Signed in as: ${user.email} (${user.id})` : "Signed in: no",
    `Received: ${at}`,
    "",
    msg.message,
    "",
    "—",
    "Sent from the contact form at keeperheadshots.com/contact. Reply to this email to answer the customer.",
  ];
  await sendMail({
    from: { name: "Keeper Headshots website", address: MAIL_FROM },
    to: CONTACT_TO,
    replyTo: { name: msg.name, address: msg.email },
    subject: `[Contact] ${TOPICS[msg.topic]} — ${msg.name}`,
    text: lines.join("\n"),
  });
  await save({ ...record, emailed: true });
  return id;
}
