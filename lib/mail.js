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
      ...(message.headers ? { headers: message.headers } : {}),
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
  console.log("[mail]", `via=${useResend() ? "resend" : "smtp"}`, `to=${[].concat(message.to).map(mask).join(",")}`, `subject="${String(message.subject).replace(/^\d{6}(?= )/, "******")}"`, `accepted=${info.accepted?.length || 0}`, `rejected=${info.rejected?.length || 0}`, `id=${info.messageId}`, `response="${info.response}"`);
  return info;
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// "Confirm your email" message. Table layout and inline styles so it renders
// the same in Gmail, Outlook and Apple Mail.
// Both account emails share one branded layout: heading, a paragraph, one
// button, the raw link as a fallback, and a closing note.
// The postal address marketing law (CAN-SPAM) requires on reminder and
// offer emails: every email that carries an unsubscribe link shows it.
export const POSTAL_ADDRESS = "Keeper Headshots LLC, 7006 Peckham Street, Johnston, IA 50131";

function brandedEmail({ title, preheader, intro, button, link, note, unsubscribe }) {
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
    ${unsubscribe ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8474;margin:18px 0 0;">You're getting this because you have a Keeper Headshots account. <a href="${escape(unsubscribe)}" style="color:#8a8474;">Stop reminder emails</a></p>` : ""}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8474;margin:18px 0 0;">Keeper Headshots &middot; <a href="https://keeperheadshots.com" style="color:#8a8474;">keeperheadshots.com</a>${unsubscribe ? `<br>${escape(POSTAL_ADDRESS)}` : ""}</p>
  </td></tr>
</table>
</body></html>`;
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const plainText = (lines) => [...lines, "", "Keeper Headshots", "https://keeperheadshots.com"].join("\n");

export function verificationEmail({ name, link, code }) {
  const first = firstName(name);
  const note = "The code and link work for 3 days. If you didn't create a Keeper Headshots account, ignore this email and nothing will happen.";
  const spaced = code ? `${code.slice(0, 3)} ${code.slice(3)}` : "";
  return {
    subject: code ? `${code} is your Keeper Headshots code` : "Confirm your email for Keeper Headshots",
    text: plainText([`Hi ${first},`, "", ...(code ? [`Your code is ${spaced}. Enter it on the Keeper Headshots page you signed up on to unlock your free preview shoot.`, "", "Or confirm with this link:"] : ["Please confirm your email address to unlock your free preview shoot:"]), "", link, "", note]),
    html: brandedEmail({
      title: "Confirm your email",
      preheader: code ? `Your code is ${spaced}. Enter it to unlock your free preview shoot.` : "One click to unlock your free preview shoot.",
      intro: code
        ? `Hi ${escape(first)}, thanks for signing up. Enter this code on the Keeper Headshots page you signed up on to unlock your <b>free preview shoot</b>:<div style="margin:18px 0 4px;font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:6px;color:#14213d;">${escape(spaced)}</div>Or confirm with the button below.`
        : `Hi ${escape(first)}, thanks for signing up. Click the button below to confirm this is your email address and unlock your <b>free preview shoot</b>.`,
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
  const lookWord = looks.length === 1 ? "look" : "looks";
  const note = `${who} has already paid for your shoot. You'll need a few recent photos of just you; your photos stay private, and ${firstName(who)} sees only your finished headshots. The invitation works for 90 days. If you weren't expecting this, you can ignore it.`;
  return {
    subject: `${who} invited you to get your ${teamName} headshot`,
    text: plainText([`Hi,`, "", `${who} is getting professional headshots for ${teamName} with Keeper Headshots, and invited you. Your shoot is paid for and set to the team's ${lookWord} (${lookText}), so everyone matches.`, "", "Start here:", "", link, "", note]),
    html: brandedEmail({
      title: `Your ${teamName} headshot`,
      preheader: `${who} invited you to a team headshot shoot. It's already paid for.`,
      intro: `${escape(who)} is getting professional headshots for <b>${escape(teamName)}</b> and invited you. Your shoot is paid for and set to the team's ${lookWord} (${escape(lookText)}), so everyone matches. Upload a few selfies and your headshots are ready in minutes.`,
      button: "Start my headshot",
      link,
      note,
    }),
  };
}

// One-time nudges (lib/reminders.js). "develop": photos checked, nothing
// developed. "buy": free shoot done, nothing bought.
export function reminderEmail({ kind, name, link, pricing, unsubscribe, pkg, preview = false }) {
  const first = firstName(name);
  const stop = `Don't want reminders like this? Turn them off: ${unsubscribe}\n${POSTAL_ADDRESS}`;
  if (kind === "develop") {
    const note = "This is the only reminder we'll send about this shoot.";
    return {
      subject: "Your photos passed the check. Ready to develop?",
      text: plainText([`Hi ${first},`, "", "Your photos are checked and ready. Pick your looks and your headshots will be developed in a few minutes:", "", link, "", note, "", stop]),
      html: brandedEmail({
        title: "Your headshots are one step away",
        preheader: "Your photos are checked. Pick your looks and develop.",
        intro: `Hi ${escape(first)}, your photos passed the check and are ready to go. Pick your backdrops and outfits, and your headshots will be developed in a few minutes, each one checked for likeness before you see it.`,
        button: "Choose my looks",
        link,
        note,
        unsubscribe,
      }),
    };
  }
  if (kind === "checkout" && pkg) {
    const note = "It's a one-time payment, and it's covered by our money-back guarantee. This is the only reminder we'll send about it.";
    const what = `${pkg.name} package (${pkg.shoots} shoots, $${pkg.price})`;
    return {
      subject: "Still deciding on your headshots?",
      text: plainText([`Hi ${first},`, "", `You started checking out the ${what} but didn't finish. Nothing was charged. If you'd still like it, you can pick up where you left off:`, "", link, "", "Questions first? Just reply to this email.", "", note, "", stop]),
      html: brandedEmail({
        title: "Your package is still here",
        preheader: `You didn't finish checking out the ${pkg.name} package. Nothing was charged.`,
        intro: `Hi ${escape(first)}, you started checking out the <b>${escape(what)}</b> but didn't finish, so nothing was charged. If you'd still like it, you can pick up where you left off. Questions first? Just reply to this email.`,
        button: "Finish checkout",
        link,
        note,
        unsubscribe,
      }),
    };
  }
  const note = "Every package is a one-time payment, and it's covered by our money-back guarantee. This is the only reminder we'll send about it.";
  return {
    subject: preview ? "Keep your headshots from $8.99" : "Try a few more looks?",
    text: plainText(
      preview
        ? [`Hi ${first},`, "", "Thanks for trying Keeper Headshots. Your free preview is ready to keep: your favorite headshot in full resolution, in every size, for $8.99. Or keep all of them and add 2 more looks to the same shoot for $14.99.", "", "Keep your headshots:", link, "", "Want more shoots? Packages from $29 include it too:", pricing, "", note, "", stop]
        : [`Hi ${first},`, "", "Thanks for trying Keeper Headshots. Want more looks? A paid shoot has up to 4 backdrop-and-outfit looks and 8 headshots:", "", pricing, "", "Your free shoot is still here:", link, "", note, "", stop],
    ),
    html: brandedEmail({
      title: preview ? "Keep your headshots" : "Try a few more looks",
      preheader: preview ? "Keep your favorite headshot for $8.99, or all of them plus 2 more looks for $14.99." : "A paid shoot has up to 4 looks and 8 headshots.",
      intro: preview
        ? `Hi ${escape(first)}, thanks for trying Keeper Headshots. Your free preview is ready to keep: your favorite headshot in full resolution, in every size, for <b>$8.99</b>. Or keep all of them and add 2 more looks to the same shoot for <b>$14.99</b>. Packages with more shoots start at $29 and include it too.`
        : `Hi ${escape(first)}, thanks for trying Keeper Headshots. If you'd like more to choose from, a paid shoot has up to <b>4 looks and 8 headshots</b>: say, a studio portrait for LinkedIn and a warmer one for your website. Your free shoot stays in your account.`,
      button: preview ? "Keep your headshots" : "See packages",
      link: preview ? link : pricing,
      note,
      unsubscribe,
    }),
  };
}

// A one-time follow-up with a discount code, sent by the owner from the
// sales funnel page (lib/outreach.js). Personal in tone: replies go to the
// owner's inbox.
export function offerEmail({ name, code, discount, until, link, pricing, usedFree, preview, unsubscribe }) {
  const first = firstName(name);
  const deal = `${discount ? `${discount} ` : ""}any package${until ? ` until ${until}` : ""}`;
  const what = preview
    ? "Every package includes your free preview's headshots in full resolution, and adds paid shoots with up to 4 looks and 8 headshots each."
    : usedFree
      ? "A paid shoot has up to 4 backdrop-and-outfit looks and 8 headshots, so you can try a few different styles."
      : "Your free preview shoot is also still waiting for you: upload a few selfies and see your headshots in a few minutes.";
  const how = `Enter ${code} on the payment page, under "Add promotion code".`;
  return {
    subject: usedFree ? "How did your headshots turn out?" : "Your free headshot preview is waiting",
    text: plainText([
      `Hi ${first},`,
      "",
      usedFree ? "Thanks for trying Keeper Headshots. How did your headshots turn out? Just reply to this email: I read every message, and I'd love to hear what worked and what didn't." : "Thanks for signing up for Keeper Headshots. Is anything stopping you from trying it? Just reply to this email: I read every message.",
      "",
      `If you'd like more, use code ${code} for ${deal}. ${what}`,
      how,
      "",
      usedFree ? "Your headshots:" : "Start your shoot:",
      link,
      "",
      "Packages:",
      pricing,
      "",
      "Christian",
      "Keeper Headshots",
      "",
      `Don't want emails like this? Turn them off: ${unsubscribe}`,
      POSTAL_ADDRESS,
    ]),
    html: brandedEmail({
      title: usedFree ? "How did your headshots turn out?" : "Your free preview is waiting",
      preheader: `Code ${code}: ${deal}.`,
      intro: `Hi ${escape(first)}, ${usedFree ? "thanks for trying Keeper Headshots. How did your headshots turn out? Just reply to this email: I read every message, and I'd love to hear what worked and what didn't." : "thanks for signing up for Keeper Headshots. Is anything stopping you from trying it? Just reply to this email: I read every message."}<br><br>If you'd like more, use code <b>${escape(code)}</b> for <b>${escape(deal)}</b>. ${escape(what)} ${escape(how)}<br><br>Christian<br>Keeper Headshots`,
      button: usedFree ? "See your headshots" : "Start your free preview",
      link,
      note: `Every package is a one-time payment, covered by our money-back guarantee.`,
      unsubscribe,
    }),
  };
}

// Sent once when a shoot has finished developing and grading, so people who
// left the page know to come back. An account email (it's about work they
// asked for), so it has no reminder unsubscribe link.
// `preview`: a free preview (watermarked until kept), which is looked at, not
// downloaded, until something is bought.
export function readyEmail({ name, shootName, count, link, graded = true, preview = false }) {
  const how = count === 1 ? (graded ? "checked for likeness and graded" : "checked for likeness") : graded ? "each checked for likeness and graded, with the best one picked out for you" : "each checked for likeness";
  const first = firstName(name);
  const n = `${count} headshot${count === 1 ? "" : "s"}`;
  const note = preview
    ? "Your preview stays in your account until you delete it. Keep your favorite for $8.99, or all of them plus 2 more looks for $14.99."
    : "Your headshots stay in your account until you delete them. Happy with them? You can share one on our home page from the results page.";
  return {
    subject: "Your headshots are ready",
    text: plainText([`Hi ${first},`, "", `Your shoot "${shootName}" is developed: ${n}, ${how}.`, "", link, "", note]),
    html: brandedEmail({
      title: "Your headshots are ready",
      preheader: graded ? `${n}, graded, with your best pick.` : preview ? `${n}, ready to see.` : `${n}, ready to download.`,
      intro: `Hi ${escape(first)}, your shoot <b>${escape(shootName)}</b> is developed: <b>${escape(n)}</b>, ${how}. ${preview ? "Have a look and see how you came out." : "Download them as portraits, squares for LinkedIn, or both."}`,
      button: "See my headshots",
      link,
      note,
    }),
  };
}
