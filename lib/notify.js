// "Your headshots are ready": sent once per shoot when it has finished
// developing and grading (lib/pipeline.js), so people who left the page know
// to come back. Not for sample shoots, the demo account or unconfirmed
// addresses. Recorded on the shoot before sending, so a regrade or a second
// server can't send it twice.

import { shoots, users, accountDeleting } from "./store.js";
import { sendMail, mailEnabled, MAIL_FROM, readyEmail } from "./mail.js";
import { isPreview } from "./preview.js";
import { ownsMailbox } from "./auth.js";

// Links in emails sent outside a request (no Host header to go on).
export const siteOrigin = () =>
  process.env.APP_ORIGIN ||
  (process.env.VERCEL_ENV === "production" ? "https://keeperheadshots.com" : process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : `http://localhost:${process.env.PORT || 3000}`);

export async function notifyReady(sid) {
  if (!mailEnabled()) return false;
  // Checked before the email is claimed, so it isn't used up on an account
  // that can't get it. An unconfirmed address still gets it once the account
  // has paid (customers pay before confirming; their receipt goes there too).
  const owner = await shoots.getMeta(sid).then((m) => m && users.byId(m.userId)).catch(() => null);
  if (!owner || owner.demo || (owner.emailVerified === false && !(owner.purchases || []).length) || await accountDeleting(owner.id)) return false;
  let claimed = false;
  const meta = await shoots.updateMeta(sid, (m) => {
    claimed = false; // storage may run this again after a conflicting write
    if (m.sample || m.readyEmailedAt || m.status !== "done" || !(m.doneCount > 0)) return false;
    m.readyEmailedAt = new Date().toISOString();
    claimed = true;
  });
  if (!claimed || !meta) return false;
  const u = await users.byId(meta.userId);
  if (!u || u.demo || (u.emailVerified === false && !(u.purchases || []).length) || await accountDeleting(u.id)) return false;
  // The shoot's name is whatever the account typed, so it only goes to an
  // inbox the account has proved is its own (not to an address someone
  // signed up with, or accepted an invitation for, without confirming it).
  const { subject, text, html } = readyEmail({ name: u.name, shootName: (ownsMailbox(u) && meta.name) || "Your shoot", count: meta.doneCount, graded: !meta.reviewError, preview: isPreview(meta, u), link: `${siteOrigin()}/app/shoot/${sid}` });
  try {
    await sendMail({ from: { name: "Keeper Headshots", address: MAIL_FROM }, to: u.email, subject, text, html });
    console.log("[notify] ready", sid);
    return true;
  } catch (err) {
    // Not retried: the headshots are on the dashboard either way.
    console.error("[notify] ready email failed", sid, err.message);
    return false;
  }
}
