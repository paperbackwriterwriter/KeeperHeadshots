// Outgoing email from hello@keeperheadshots.com. Used by the contact form and
// account emails. With RESEND_API_KEY set, mail goes through Resend's API
// (domain verified in Resend, DKIM on the domain); otherwise through SMTP
// (ImprovMX) with SMTP_PASS. Incoming mail to hello@ is unaffected either way:
// ImprovMX still receives and forwards it.

import nodemailer from "nodemailer";

export const SMTP_USER = process.env.SMTP_USER || "hello@keeperheadshots.com";
export const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;
const RESEND_URL = `${process.env.RESEND_BASE_URL || "https://api.resend.com"}/emails`;
const useResend = () => !!process.env.RESEND_API_KEY;
export const mailEnabled = () => useResend() || !!process.env.SMTP_PASS;

let transport;
const mailer = () =>
  (transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.improvmx.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: process.env.SMTP_PASS },
    // A stalled mail server must not hold a request open for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  }));

// Addresses come in as "a@b.com" or { name, address }.
const addr = (a) => (typeof a === "string" ? a : a.name ? `${a.name.replace(/[<>"]/g, "")} <${a.address}>` : a.address);

async function sendResend(message) {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: addr(message.from),
      to: [].concat(message.to).map(addr),
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { reply_to: addr(message.replyTo) } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || data.name || "send failed"}`);
  return { messageId: data.id, accepted: [].concat(message.to), rejected: [], response: `resend ${res.status} id=${data.id}` };
}

// Logs the provider's reply (Resend id, or SMTP "250 Ok: queued as …") with a
// masked recipient, so any message can be traced in the provider's logs.
const mask = (a) => String(a?.address || a).replace(/^(.)[^@]*(@.*)$/, "$1***$2");
export async function sendMail(message) {
  const info = useResend() ? await sendResend(message) : await mailer().sendMail(message);
  console.log("[mail]", `via=${useResend() ? "resend" : "smtp"}`, `to=${[].concat(message.to).map(mask).join(",")}`, `subject="${message.subject}"`, `accepted=${info.accepted?.length || 0}`, `rejected=${info.rejected?.length || 0}`, `id=${info.messageId}`, `response="${info.response}"`);
  return info;
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// "Confirm your email" message. Table layout and inline styles so it renders
// the same in Gmail, Outlook and Apple Mail.
// Both account emails share one branded layout: heading, a paragraph, one
// button, the raw link as a fallback, and a closing note.
function brandedEmail({ title, preheader, intro, button, link, note }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f1ea;">
<div style="display:none;max-height:0;overflow:hidden;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1ea;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e4dccd;">
      <tr><td style="padding:32px 36px 8px;font-family:Georgia,'Times New Roman',serif;">
        <span style="display:inline-block;border:2px solid #b8893b;padding:2px 8px;font-size:20px;font-weight:700;color:#14213d;">K</span>
        <span style="font-size:20px;font-weight:700;color:#14213d;vertical-align:middle;margin-left:8px;">Keeper</span>
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:3px;color:#8c6a2c;vertical-align:middle;margin-left:4px;">HEADSHOTS</span>
      </td></tr>
      <tr><td style="padding:16px 36px 0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#14213d;">${escape(title)}</td></tr>
      <tr><td style="padding:14px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#3a4152;">
        ${intro}
      </td></tr>
      <tr><td style="padding:28px 36px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#7a2e2e;">
          <a href="${escape(link)}" style="display:inline-block;padding:15px 30px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${escape(button)}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:18px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#6b665b;">
        Button not working? Copy this link into your browser:<br><a href="${escape(link)}" style="color:#7a2e2e;word-break:break-all;">${escape(link)}</a>
      </td></tr>
      <tr><td style="padding:22px 36px 32px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#6b665b;">
        ${escape(note)}
      </td></tr>
    </table>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8474;margin:18px 0 0;">Keeper Headshots &middot; <a href="https://keeperheadshots.com" style="color:#8a8474;">keeperheadshots.com</a></p>
  </td></tr>
</table>
</body></html>`;
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const plainText = (lines) => [...lines, "", "Keeper Headshots", "https://keeperheadshots.com"].join("\n");

export function verificationEmail({ name, link }) {
  const first = firstName(name);
  const note = "The link works for 3 days. If you didn't create a Keeper Headshots account, ignore this email and nothing will happen.";
  return {
    subject: "Confirm your email for Keeper Headshots",
    text: plainText([`Hi ${first},`, "", "Please confirm your email address to unlock your free Keeper Headshots shoot:", "", link, "", note]),
    html: brandedEmail({
      title: "Confirm your email",
      preheader: "One click to unlock your free headshot shoot.",
      intro: `Hi ${escape(first)}, thanks for signing up. Click the button below to confirm this is your email address and unlock your <b>free shoot</b>.`,
      button: "Confirm my email",
      link,
      note,
    }),
  };
}

export function passwordResetEmail({ name, link }) {
  const first = firstName(name);
  const note = "The link works for 1 hour and only once. If you didn't ask to reset your password, ignore this email: your password stays the same.";
  return {
    subject: "Reset your Keeper Headshots password",
    text: plainText([`Hi ${first},`, "", "Someone (hopefully you) asked to reset the password for your Keeper Headshots account. Choose a new password here:", "", link, "", note]),
    html: brandedEmail({
      title: "Reset your password",
      preheader: "Choose a new password for your Keeper Headshots account.",
      intro: `Hi ${escape(first)}, we got a request to reset the password for your Keeper Headshots account. Click the button below to choose a new one.`,
      button: "Choose a new password",
      link,
      note,
    }),
  };
}

// A team admin invites a colleague (lib/teams.js). `looks` are display names.
export function teamInviteEmail({ ownerName, teamName, link, looks }) {
  const who = String(ownerName || "Your team admin").trim();
  const lookText = looks.length === 1 ? looks[0] : `${looks.slice(0, -1).join(", ")} and ${looks[looks.length - 1]}`;
  const note = `${who} has already paid for your shoot. You'll need a few recent photos of just you; your photos stay private, and ${firstName(who)} sees only your finished headshots. If you weren't expecting this, you can ignore it.`;
  return {
    subject: `${who} invited you to get your ${teamName} headshot`,
    text: plainText([`Hi,`, "", `${who} is getting professional headshots for ${teamName} with Keeper Headshots, and invited you. Your shoot is paid for and set to the team's look (${lookText}), so everyone matches.`, "", "Start here:", "", link, "", note]),
    html: brandedEmail({
      title: `Your ${teamName} headshot`,
      preheader: `${who} invited you to a team headshot shoot. It's already paid for.`,
      intro: `${escape(who)} is getting professional headshots for <b>${escape(teamName)}</b> and invited you. Your shoot is paid for and set to the team's look (${escape(lookText)}), so everyone matches. Upload a few selfies and your headshots are ready in minutes.`,
      button: "Start my headshot",
      link,
      note,
    }),
  };
}
