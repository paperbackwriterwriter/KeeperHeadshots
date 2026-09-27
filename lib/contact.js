// Contact form: every message is saved to storage first, then emailed to the
// team inbox through SMTP (ImprovMX) with Reply-To set to the sender, so a
// plain "Reply" in Gmail answers the customer.

import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { putJSON } from "./storage.js";

export const CONTACT_TO = process.env.CONTACT_TO || "hello@keeperheadshots.com";
const SMTP_USER = process.env.SMTP_USER || "hello@keeperheadshots.com";

// Kept in sync with TOPICS in public/js/views/contact.js.
export const TOPICS = {
  general: "General question",
  shoot: "Help with a shoot",
  billing: "Billing or refunds",
  team: "Team headshots",
  press: "Press or partnerships",
};

export const contactEnabled = () => !!process.env.SMTP_PASS;

let transport;
const mailer = () =>
  (transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.improvmx.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: process.env.SMTP_PASS },
  }));

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

// A light per-instance limit; enough to stop a script hammering the form.
const recent = new Map();
export function rateLimited(ip, limit = 5, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > limit;
}

export async function submit(msg, { user, ip } = {}) {
  const at = new Date().toISOString();
  const id = `${at.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
  const record = { id, at, ...msg, topicLabel: TOPICS[msg.topic], account: user ? { id: user.id, email: user.email } : null, ip, emailed: false };
  await putJSON(`contact/${id}.json`, record);

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
  await mailer().sendMail({
    from: { name: "Keeper Headshots website", address: SMTP_USER },
    to: CONTACT_TO,
    replyTo: { name: msg.name, address: msg.email },
    subject: `[Contact] ${TOPICS[msg.topic]} — ${msg.name}`,
    text: lines.join("\n"),
  });
  await putJSON(`contact/${id}.json`, { ...record, emailed: true });
  return id;
}
