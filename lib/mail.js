// Outgoing email through SMTP (ImprovMX, from hello@keeperheadshots.com, with
// DKIM on the domain). Used by the contact form and account emails.

import nodemailer from "nodemailer";

export const SMTP_USER = process.env.SMTP_USER || "hello@keeperheadshots.com";
export const mailEnabled = () => !!process.env.SMTP_PASS;

let transport;
const mailer = () =>
  (transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.improvmx.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: process.env.SMTP_PASS },
  }));

export const sendMail = (message) => mailer().sendMail(message);

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// "Confirm your email" message. Table layout and inline styles so it renders
// the same in Gmail, Outlook and Apple Mail.
export function verificationEmail({ name, link }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const text = [
    `Hi ${first},`,
    "",
    "Please confirm your email address to unlock your free Keeper Headshots shoot:",
    "",
    link,
    "",
    "The link works for 3 days. If you didn't create an account, you can ignore this email and nothing will happen.",
    "",
    "Keeper Headshots",
    "https://keeperheadshots.com",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Confirm your email</title></head>
<body style="margin:0;padding:0;background:#f5f1ea;">
<div style="display:none;max-height:0;overflow:hidden;">One click to unlock your free headshot shoot.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1ea;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e4dccd;">
      <tr><td style="padding:32px 36px 8px;font-family:Georgia,'Times New Roman',serif;">
        <span style="display:inline-block;border:2px solid #b8893b;padding:2px 8px;font-size:20px;font-weight:700;color:#14213d;">K</span>
        <span style="font-size:20px;font-weight:700;color:#14213d;vertical-align:middle;margin-left:8px;">Keeper</span>
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:3px;color:#8c6a2c;vertical-align:middle;margin-left:4px;">HEADSHOTS</span>
      </td></tr>
      <tr><td style="padding:16px 36px 0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#14213d;">Confirm your email</td></tr>
      <tr><td style="padding:14px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#3a4152;">
        Hi ${escape(first)}, thanks for signing up. Click the button below to confirm this is your email address and unlock your <b>free shoot</b>.
      </td></tr>
      <tr><td style="padding:28px 36px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#7a2e2e;">
          <a href="${escape(link)}" style="display:inline-block;padding:15px 30px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">Confirm my email</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:18px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#6b665b;">
        Button not working? Copy this link into your browser:<br><a href="${escape(link)}" style="color:#7a2e2e;word-break:break-all;">${escape(link)}</a>
      </td></tr>
      <tr><td style="padding:22px 36px 32px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#6b665b;">
        The link works for 3 days. If you didn't create a Keeper Headshots account, ignore this email and nothing will happen.
      </td></tr>
    </table>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8474;margin:18px 0 0;">Keeper Headshots &middot; <a href="https://keeperheadshots.com" style="color:#8a8474;">keeperheadshots.com</a></p>
  </td></tr>
</table>
</body></html>`;

  return { subject: "Confirm your email for Keeper Headshots", text, html };
}
