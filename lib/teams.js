// Team orders: one person (the team admin) buys shoots and invites colleagues
// by email. Each invite sets aside one shoot from the admin's balance; the
// colleague accepts with their own account and gets a shoot that's already
// paid for and fixed to the team's look, so everyone matches. The admin sees
// each person's progress and can download each one's chosen headshot (never
// their selfies). A cancelled invite, or a team shoot deleted before it's
// developed, gives the shoot back to the admin.
//
//   teams/<teamId>.json     { id, ownerId, ownerName, name, looks, invites: { <inviteId>: {...} } }
//   invites/<token>.json    { teamId, inviteId }  (the secret in the emailed link)

import crypto from "node:crypto";
import { createJSON, getJSON, putJSON, updateJSON, del, list, UNCHANGED } from "./storage.js";
import { users, shoots, id, canonicalEmail } from "./store.js";
import { ownsMailbox } from "./auth.js";
import { planFor, PlanError, creditSource, creditLots } from "./plan.js";
import { lookFor, MAX_LOOKS } from "../public/js/shared/catalog.js";
import { ADDRESS_LIKE, isEmailAddress } from "./mail.js";

// Per team, counting only invitations still live: open ("invited") or taken
// ("joined", developed or not, also after the member deleted their account).
// Cancelled (and withdrawn by a refund), expired and returned ones gave their
// shoot back to the admin, so they don't count (owner's decision, 6 Nov).
export const MAX_INVITES = 100;
// And at most this many invitations stored in all, whatever became of them, so
// inviting and cancelling over and over can't send unlimited emails from us.
export const MAX_INVITES_EVER = 300;
const LIVE = ["invited", "joined"];

// Returns one credit to an account: a refund debt (lib/billing.js
// reconcileRefund) is settled before the balance grows.
export function giveBack(u) {
  if ((u.creditsOwed || 0) > 0) u.creditsOwed -= 1;
  else u.credits = (u.credits || 0) + 1;
  if (!u.creditsOwed) delete u.creditsOwed;
}
// A develop charge still recorded on the account (server.js /generate) for a
// shoot that never started and is now gone: a credit comes back. Returns
// whether one did.
export function releaseDeveloping(u, sid) {
  const memo = u.developing?.[sid];
  if ((typeof memo === "object" ? memo?.charged : memo) !== "credit") return false;
  undoDevelopCharge(u, sid);
  return true;
}
// Gives back the credit a develop of this shoot charged (its memo on the
// account), once. A refund of the paying package that landed meanwhile counted
// that credit as spent and couldn't take it (lib/billing.js reconcileRefund):
// it's taken now, by not coming back.
export function undoDevelopCharge(u, sid) {
  const memo = u.developing?.[sid];
  if (!memo) return;
  delete u.developing[sid];
  const short = typeof memo === "object" && memo.at && (u.refunds || []).find((r) => r.sessionId === memo.paidBy && (r.at || "") >= memo.at && (r.shootsRemoved || 0) > (r.creditsTaken ?? r.shootsRemoved ?? 0) + (r.owedAdded || 0));
  if (short) short.creditsTaken = (short.creditsTaken || 0) + 1;
  else giveBack(u);
}
export const INVITE_TTL_DAYS = 90; // an unopened invitation lapses and gives the shoot back
const lapsed = (inv, now) => inv.status === "invited" && Date.parse(inv.invitedAt) + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000 < now;
export const inviteLapsed = (inv) => lapsed(inv, Date.now());

// Expires the team's unopened invitations older than INVITE_TTL_DAYS, giving
// each shoot back to the admin; returns how many lapsed.
export async function expireInvites(team, now = Date.now()) {
  let n = 0;
  for (const inv of Object.values(team?.invites || {})) if (lapsed(inv, now) && (await release(team.id, inv.id, "invited", "expired"))) n++;
  return n;
}
const teamKey = (tid) => `teams/${tid}.json`;
const inviteKey = (token) => `invites/${token}.json`;
const normEmail = (e) => String(e || "").trim().toLowerCase();
const isEmail = (e) => e.length <= 200 && isEmailAddress(e);
// The same inbox written differently: capital letters anywhere, and dots and
// +tags only at Gmail, where they're certainly the same mailbox. Elsewhere
// "bob+x@corp.com" can be someone else's inbox (or a catch-all), so it isn't
// matched here. (lib/store.js canonicalEmail, used for the free shoot and the
// mail limits, merges more: there, merging too much is the safe side.)
const GMAIL = new Set(["gmail.com", "googlemail.com"]);
const inviteInbox = (email) => {
  const [local = "", domain = ""] = normEmail(email).replace(/\.+$/, "").split("@");
  return GMAIL.has(domain) ? canonicalEmail(`${local}@${domain}`) : `${local.replace(/"/g, "")}@${domain}`;
};
export const sameInbox = (a, b) => !!a && !!b && inviteInbox(a) === inviteInbox(b);
// Whether this account may take an invitation sent to `invited`: its own
// address exactly, or another way of writing the same inbox once the account
// has confirmed its address itself (ownsMailbox: the emailed link or code, or
// Google), so it's proven to reach that inbox. (Sign-up keeps the two as
// separate accounts; neither is merged.)
// (Confirmed explicitly: an account from before confirmation existed counts as
// confirmed elsewhere, but not here; owner's decision, 6 Nov.)
const confirmedItself = (user) => user?.emailVerified === true && ownsMailbox(user);
export const inviteFor = (user, invited) => normEmail(user?.email) === invited || (sameInbox(user?.email, invited) && confirmedItself(user));
// Why another spelling can't accept yet: "code" (confirm the address first) or
// "exact" (an old account that can't: the admin sends it to its own address).
export const variantBlock = (user) => (user?.emailVerified === false || user?.emailVerifiedVia === "invite" ? "code" : "exact");

export function cleanLooks(list) {
  const looks = (Array.isArray(list) ? list : [])
    .map((l) => (l && typeof l === "object" ? lookFor(String(l.backdrop), String(l.outfit)) : null))
    .filter(Boolean);
  const unique = [...new Map(looks.map((l) => [l.id, l])).values()].slice(0, MAX_LOOKS);
  return unique.map((l) => ({ backdrop: l.backdrop.id, outfit: l.outfit.id }));
}

export const getTeam = (teamId) => (teamId ? getJSON(teamKey(teamId)) : null);

// Creates the admin's team, or updates its name and looks.
export async function saveTeam(owner, { name, looks }) {
  const cleanName = String(name || "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const cleanLookList = cleanLooks(looks);
  if (!cleanName) throw new PlanError("Give your team a name.", "team_name", 400);
  // It goes into invitation emails sent from our address: a name, not a message.
  // (Look-alike dots and soft hyphens count as the real thing.)
  // (A team keeps the name it already has: one saved before the address rule
  // can still change its looks.)
  const plain = cleanName.normalize("NFKC").replace(/\u00ad/g, "");
  const current = owner.teamId ? (await getTeam(owner.teamId).catch(() => null))?.name : null;
  if (cleanName !== current && (/https?:|www\.|[<>@]/i.test(plain) || ADDRESS_LIKE.test(plain))) throw new PlanError("Use just your team's name (no links or email addresses).", "team_name", 400);
  if (!cleanLookList.length) throw new PlanError("Pick at least one look for your team.", "team_looks", 400);
  if (owner.teamId) {
    return updateJSON(teamKey(owner.teamId), (t) => ({ ...t, name: cleanName, looks: cleanLookList, updatedAt: new Date().toISOString() }));
  }
  const team = { id: id("team"), ownerId: owner.id, ownerName: owner.name, name: cleanName, looks: cleanLookList, invites: {}, createdAt: new Date().toISOString() };
  await createJSON(teamKey(team.id), team);
  // Two tabs creating at once: the first team recorded on the account wins.
  let teamId = team.id;
  await users.update(owner.id, (u) => {
    if (u.teamId) return void (teamId = u.teamId);
    u.teamId = team.id;
  });
  if (teamId !== team.id) {
    await del(teamKey(team.id));
    return getTeam(teamId);
  }
  return team;
}

// Invites one address. Sets aside one of the admin's shoots first (atomically,
// so two invites can't share a shoot), and gives it back if anything after
// that fails. Returns { team, invite } (invite.token is for the email link).
export async function invite(owner, email) {
  const addr = normEmail(email);
  if (!isEmail(addr)) throw new PlanError(`"${String(email).slice(0, 80)}" isn't an email address.`, "invite_email", 400);
  if (sameInbox(addr, owner.email)) throw new PlanError("That's your own address. Start a shoot for yourself from your dashboard instead.", "invite_self", 400);
  let team = await getTeam(owner.teamId);
  if (!team) throw new PlanError("Set up your team first.", "no_team", 400);
  if (await expireInvites(team)) team = await getTeam(owner.teamId);
  // One inbox is one person, however its address is written: a second
  // spelling would cost a second shoot, and either could be accepted.
  const onTeam = (t) => Object.values(t.invites || {}).find((i) => LIVE.includes(i.status) && sameInbox(i.email, addr));
  // (Another spelling still waiting to be accepted: say how to switch to this
  // one, as the join page tells such a person to ask for.)
  const already = (i) => new PlanError(`${addr} is already on the team${i.email === addr ? "" : ` (as ${i.email})`}.${i.email !== addr && i.status === "invited" ? " To invite this address instead, cancel that invitation first." : ""}`, "invite_dup", 409);
  if (onTeam(team)) throw already(onTeam(team));
  // (Checked again inside the save below, so two at once can't pass the caps.)
  const capped = (t) =>
    Object.keys(t.invites || {}).length >= MAX_INVITES_EVER ? new PlanError("This team has sent a lot of invitations. Contact us to invite more people.", "invite_max", 409)
    : Object.values(t.invites || {}).filter((i) => LIVE.includes(i.status)).length >= MAX_INVITES ? new PlanError(`A team can have up to ${MAX_INVITES} people invited or joined at once. Contact us for a larger team.`, "invite_max", 409)
    : null;
  if (capped(team)) throw capped(team);

  let paidBy = null;
  await users.update(owner.id, (u) => {
    paidBy = null;
    const p = planFor(u);
    if (p.tier === "owner") return UNCHANGED; // site owners aren't charged
    if (!(p.credits > 0)) throw new PlanError("You've no shoots left to give. Buy a package to invite more people.", "no_shoots_left");
    // Seats a refund left unpaid (lib/billing.js reconcileRefund) block new
    // invitations from being accepted (seatPaid), so don't charge for one.
    if ((u.creditsOwed || 0) > 0) throw new PlanError(`A refund left ${u.creditsOwed} of your team's shoots unpaid. A new package settles ${u.creditsOwed === 1 ? "it" : "them"}; then you can invite more people.`, "seats_unpaid", 409);
    paidBy = creditSource(u);
    u.credits = p.credits - 1;
  });
  const charged = planFor(owner).tier !== "owner";
  try {
    const token = crypto.randomBytes(24).toString("base64url");
    const inv = { id: id("inv"), email: addr, token, status: "invited", invitedAt: new Date().toISOString(), sentAt: null, charged, ...(paidBy ? { paidBy } : {}) };
    let dup = null;
    let full = null;
    const saved = await updateJSON(teamKey(team.id), (t) => {
      dup = onTeam(t) || null; // the callback may run again after a write conflict
      full = dup ? null : capped(t);
      return dup || full ? UNCHANGED : { ...t, invites: { ...t.invites, [inv.id]: inv } };
    });
    if (dup) throw already(dup);
    if (full) throw full;
    await createJSON(inviteKey(token), { teamId: team.id, inviteId: inv.id });
    return { team: saved, invite: inv };
  } catch (err) {
    if (charged) await users.update(owner.id, giveBack).catch((e) => console.error("[team] refund after failed invite", owner.id, e.message));
    throw err;
  }
}

export const markSent = (teamId, inviteId) =>
  updateJSON(teamKey(teamId), (t) => {
    if (!t.invites?.[inviteId]) return UNCHANGED;
    const now = new Date().toISOString(); // one moment for both, so a resend's 90 days start when it was sent
    return { ...t, invites: { ...t.invites, [inviteId]: { ...t.invites[inviteId], sentAt: now, ...(t.invites[inviteId].status === "invited" ? { invitedAt: now } : {}) } } };
  });

// Gives an unused shoot back to the admin: a cancelled invite, or a team shoot
// deleted before it was developed. `from` is the status it must still have;
// `extra` is recorded on the invite with its new status.
async function release(teamId, inviteId, from, to, extra = {}) {
  let inv = null;
  await updateJSON(teamKey(teamId), (t) => {
    inv = null; // the callback may run again after a write conflict
    const cur = t.invites?.[inviteId];
    if (!cur || cur.status !== from) return UNCHANGED;
    inv = cur;
    return { ...t, invites: { ...t.invites, [inviteId]: { ...cur, status: to, endedAt: new Date().toISOString(), ...extra } } };
  });
  if (!inv) return false;
  const team = await getTeam(teamId);
  if (inv.charged) {
    // A refund may have taken back credits that were already on seats
    // (lib/billing.js reconcileRefund): this seat settles that first.
    await users.update(team.ownerId, giveBack);
  }
  await del(inviteKey(inv.token)).catch(() => {});
  return true;
}
export const cancelInvite = (owner, inviteId) => release(owner.teamId, inviteId, "invited", "cancelled");
// A team shoot deleted by its member before developing.
// The member's team shoot is gone, so their team no longer pays for one
// (teamSeatReturned: lib/plan.js teamMember, cleared on joining again).
// A team seat is spent once its shoot has developed, or once it has moved to
// a free reshoot (moveSeat): the first shoot developed with it.
const seatSpent = (m) => (m?.shots || []).length > 0 || !!m?.team?.seatUsed;

// A member deleted their developed team shoot while its free reshoot is still
// there (owner's decision, 4 Nov): the reshoot takes over the seat, so the
// admin keeps seeing its headshot and, if not yet developed, it still
// develops free in the team's looks. Already spent, the seat is never given
// back (returnSeat) or counted as unspent credit.
export async function moveSeat(meta, reshootId) {
  if (!meta.team?.id || !meta.team.inviteId) return false;
  let moved = false;
  await shoots.updateMeta(reshootId, (m) => {
    moved = false;
    if (m.reshootOf !== meta.id || m.userId !== meta.userId || m.team) return false;
    m.team = { ...meta.team, seatUsed: true };
    delete m.reshootOf;
    delete m.reshootLooks;
    m.paidWith = "team";
    moved = true;
  });
  if (!moved) return false;
  await updateJSON(teamKey(meta.team.id), (t) => {
    const cur = t.invites?.[meta.team.inviteId];
    if (!cur || cur.status !== "joined" || cur.shootId !== meta.id) return UNCHANGED;
    return { ...t, invites: { ...t.invites, [cur.id]: { ...cur, shootId: reshootId } } };
  });
  return true;
}

export async function returnSeat(meta) {
  if (!meta.team?.id || !meta.team.inviteId || meta.team.seatUsed) return false;
  const released = await release(meta.team.id, meta.team.inviteId, "joined", "returned");
  // (Not while another team's shoot of theirs is still there: they joined
  // more than one team.)
  const otherTeamShoot = meta.userId && (await shoots.forUser(meta.userId).catch(() => [])).some((s) => s.team?.id && s.id !== meta.id);
  if (meta.userId && !otherTeamShoot) await users.update(meta.userId, (u) => (u.joinedTeam === meta.team.id && u.teamSeatReturned !== meta.team.id ? void (u.teamSeatReturned = meta.team.id) : UNCHANGED)).catch(() => {}); // (the account may be going too)
  return released;
}

// Whether a team seat is still paid for: a refund that took back more credits
// than the admin had left (creditsOwed, lib/billing.js) leaves seats unpaid
// until invitations are withdrawn or a new package settles it.
export async function seatPaid(meta) {
  const team = meta.team?.ownerId ? meta.team : await getTeam(meta.team?.id);
  const owner = team && (await users.byId(team.ownerId));
  // The team is gone (the admin deleted their account): the seat was paid
  // for when the invitation was sent, unless removeTeam marked it unpaid.
  if (!owner) return !meta.team?.unpaid;
  if (!((owner.creditsOwed || 0) > 0)) return true;
  // A seat paid by a package that wasn't refunded stays paid; only seats of a
  // refunded package can be what the debt is for. (Older seats don't record
  // their package, and go unpaid as before.)
  const by = meta.team?.paidBy;
  return !!by && !refundedPackage(owner, by);
}
// Whether the package that paid for this team seat was refunded in full
// (like a customer's own shoot's, its free reshoot goes with it: server.js
// paidForRefunded). Older seats don't record their package: not known.
export async function seatPackageRefunded(meta) {
  const by = meta.team?.paidBy;
  const team = by && (await getTeam(meta.team.id));
  const owner = team && (await users.byId(team.ownerId));
  return !!(owner?.purchases || []).find((p) => p.sessionId === by)?.refunded;
}
// A package whose refund left the account owing (it reached seats it paid
// for). A refund that only took that package's unused shoots doesn't count.
// (Older refund entries don't record it: any shoots removed, as before.)
// A chargeback we won gave back what it took, debt included: it doesn't count.
const refundedPackage = (u, sid) => (u.refunds || []).some((r) => r.sessionId === sid && !r.disputeWon && (r.creditsTaken === undefined ? r.shootsRemoved > 0 : r.owedAdded > 0));
// A seat counts against a package's refund if that package paid for it (or,
// for older seats, if nothing records which one did).
const paidWith = (inv, sid) => !sid || !inv.paidBy || inv.paidBy === sid;

// How many of the admin's credits sit on team seats right now: open
// invitations and seats taken but not yet developed. A refund can only put
// those in debt (lib/billing.js reconcileRefund).
export async function seatsOnCredit(ownerId, sessionId = null) {
  const owner = await users.byId(ownerId);
  const team = owner?.teamId && (await getTeam(owner.teamId));
  let n = 0;
  for (const inv of Object.values(team?.invites || {})) {
    if (!inv.charged || !paidWith(inv, sessionId)) continue;
    if (inv.status === "invited") n++;
    else if (inv.status === "joined" && inv.shootId) {
      const meta = await shoots.getMeta(inv.shootId).catch(() => null);
      if (meta && !meta.team?.seatUsed && ["draft", "checking", "checked"].includes(meta.status)) n++;
    }
  }
  return n;
}

// Withdraws the admin's open invitations, newest first, until the refund debt
// is settled (each one returned settles one credit). Returns how many.
// (Marked withdrawnByRefund, so the admin's team page can say what happened.)
export async function settleDebt(ownerId, sessionId = null) {
  const owner = await users.byId(ownerId);
  let owed = owner?.creditsOwed || 0;
  if (!owed || !owner.teamId) return 0;
  const team = await getTeam(owner.teamId);
  const open = Object.values(team?.invites || {}).filter((i) => i.status === "invited" && i.charged && paidWith(i, sessionId)).sort((a, b) => String(b.invitedAt).localeCompare(String(a.invitedAt)));
  let n = 0;
  for (const inv of open) {
    if (owed <= 0) break;
    if (await release(team.id, inv.id, "invited", "cancelled", { withdrawnByRefund: true })) {
      n++;
      owed--;
    }
  }
  return n;
}

export async function readInvite(token) {
  if (!/^[\w-]{20,60}$/.test(String(token || ""))) return null;
  const ref = await getJSON(inviteKey(token));
  const team = ref && (await getTeam(ref.teamId));
  const inv = team?.invites?.[ref.inviteId];
  if (!inv || inv.token !== token) return null;
  if (lapsed(inv, Date.now())) {
    await expireInvites(team);
    return null;
  }
  return { team, invite: inv };
}

// The invited person accepts, signed in with the invited address. Creates
// their team shoot (once; accepting again returns the same shoot).
export async function accept(user, token) {
  const found = await readInvite(token);
  if (!found) throw new PlanError("This invitation isn't valid any more: it may have been cancelled, or lapsed after 90 days. Ask your team admin for a new one.", "invite_invalid", 404);
  const { team, invite: inv } = found;
  if (!inviteFor(user, inv.email)) {
    // The same inbox under another spelling, not yet confirmed by its owner.
    if (sameInbox(user.email, inv.email) && variantBlock(user) === "exact") throw new PlanError(`This invitation was sent to ${inv.email}. Ask your team admin to cancel it and invite ${normEmail(user.email)} instead, then open the new link.`, "invite_other_email", 403);
    if (sameInbox(user.email, inv.email)) throw new PlanError(`This invitation was sent to ${inv.email}. To accept it as ${normEmail(user.email)}, first confirm that address: enter the 6-digit code from our email on your Account page.`, "invite_confirm_email", 403);
    throw new PlanError(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`, "invite_other_email", 403);
  }
  if (inv.status === "joined" && inv.userId === user.id && inv.shootId) return { shootId: inv.shootId, team };
  if (inv.status !== "invited") throw new PlanError("This invitation has already been used or cancelled.", "invite_used", 409);
  if (inv.charged && !(await seatPaid({ team: { ...team, ...(inv.paidBy ? { paidBy: inv.paidBy } : {}) } }))) throw new PlanError("This invitation isn't paid for any more. Ask your team admin for a new one.", "invite_unpaid", 409);

  const sid = id("sht");
  let won = false;
  await updateJSON(teamKey(team.id), (t) => {
    won = false; // the callback may run again after a write conflict
    const cur = t.invites?.[inv.id];
    if (!cur || cur.status !== "invited") return UNCHANGED;
    won = true;
    return { ...t, invites: { ...t.invites, [inv.id]: { ...cur, status: "joined", userId: user.id, name: user.name, shootId: sid, joinedAt: new Date().toISOString() } } };
  });
  if (!won) {
    const again = await readInvite(token);
    if (again?.invite.status === "joined" && again.invite.userId === user.id) return { shootId: again.invite.shootId, team };
    throw new PlanError("This invitation has already been used or cancelled.", "invite_used", 409);
  }
  const now = new Date().toISOString();
  await shoots.create({
    id: sid,
    userId: user.id,
    name: `${team.name} headshot`.slice(0, 60),
    status: "draft",
    createdAt: now,
    selfies: [],
    check: null,
    looks: [],
    shots: [],
    review: null,
    error: null,
    team: { id: team.id, inviteId: inv.id, name: team.name, ownerName: team.ownerName, looks: team.looks, ...(inv.paidBy ? { paidBy: inv.paidBy } : {}) },
    paidWith: "team",
  });
  // The invitation lets the team shoot go ahead. It doesn't prove the person
  // owns the inbox (the admin was given the link too), so it's marked as such:
  // the free shoot and owner access still need the emailed link or code.
  // (joinedTeam: the account's first shoot was paid for by a team, so it
  // isn't told to buy a package for it; lib/plan.js teamMember.)
  await users.update(user.id, (u) => {
    if (u.emailVerified !== false && u.joinedTeam === team.id && !u.teamSeatReturned) return UNCHANGED;
    u.joinedTeam = team.id;
    delete u.teamSeatReturned;
    if (u.emailVerified !== false) return;
    u.emailVerified = true;
    u.emailVerifiedVia = "invite";
    u.emailVerifiedAt = now;
  });
  return { shootId: sid, team };
}

const lookSet = (list) => JSON.stringify((list || []).map((l) => `${l.backdrop}/${l.outfit}`).sort());

// The admin's view: every invite with its person's progress and, once done,
// the chosen headshot. What a refund changed is shown too: invitations it
// withdrew (settleDebt) as "withdrawn", with when, and taken seats it left
// unpaid (seatPaid) as `unpaid`.
export async function teamStatus(owner) {
  let team = await getTeam(owner.teamId);
  if (!team) return null;
  if (await expireInvites(team)) team = await getTeam(owner.teamId);
  let looksVary = false;
  const members = await Promise.all(
    Object.values(team.invites || {})
      .filter((i) => i.status !== "cancelled" || i.withdrawnByRefund)
      .sort((a, b) => String(a.invitedAt || "").localeCompare(String(b.invitedAt || "")))
      .map(async (i) => {
        const base = { id: i.id, email: i.email, status: i.status, name: i.name || null, invitedAt: i.invitedAt, sentAt: i.sentAt };
        // (Re-invited: the same inbox, however it's spelled, was invited again
        // afterwards; the team page then leaves this row out.)
        const invitedAgain = i.status === "cancelled" && Object.values(team.invites || {}).some((o) => o.id !== i.id && sameInbox(o.email, i.email) && String(o.invitedAt || "") > String(i.invitedAt || ""));
        if (i.status === "cancelled") return { ...base, status: "withdrawn", endedAt: i.endedAt || null, ...(invitedAgain ? { reinvited: true } : {}) };
        if (i.forgotten) return { ...base, email: null, name: "Deleted account", status: "account_deleted" };
        if (i.status !== "joined" || !i.shootId) return base;
        const s = await shoots.get(i.shootId).catch(() => null);
        if (!s) return { ...base, status: "deleted" };
        const unpaid = !!i.charged && !seatSpent(s) && (owner.creditsOwed || 0) > 0 && !(await seatPaid({ team: { ...team, ...(i.paidBy ? { paidBy: i.paidBy } : {}) } }).catch(() => true));
        // A free reshoot (server.js /reshoot) is this seat taken again with
        // new selfies: once it's done, its pick is shown instead, unless the
        // person chose one from the first shoot and none from the reshoot.
        const again = s.reshootUsed ? await shoots.get(s.reshootUsed).catch(() => null) : null;
        const shown = again && again.userId === s.userId && again.reshootOf === s.id && again.status === "done" && again.shots.some((x) => x.status === "done") && !(s.pickedShotId && !again.pickedShotId) ? again : s;
        const done = shown.shots.filter((x) => x.status === "done");
        const pick = done.find((x) => x.id === shown.pickedShotId) || done.find((x) => x.id === shown.review?.bestShotId) || done[0] || null;
        // Joined before the team's looks changed: their shoot keeps the old ones.
        if (lookSet(s.team?.looks) !== lookSet(team.looks)) looksVary = true;
        return { ...base, shootId: s.id, shootStatus: shown.status, selfies: s.selfies.length, done: done.length, pick: shown.status === "done" && pick ? pick.file : null, ...(unpaid ? { unpaid: true } : {}) };
      }),
  );
  // (looksVary: the team page can't say everyone gets the current looks.)
  return { id: team.id, name: team.name, looks: team.looks, members, ...(looksVary ? { looksVary } : {}) };
}

// Whether `viewer` (a team admin) may download this file of a member's team
// shoot: finished headshots only, never the member's selfies.
// (A team shoot's free reshoot counts as that team shoot: teamStatus may show it.)
export async function adminMayView(viewer, meta, file) {
  const seat = !meta.team && meta.reshootOf ? await shoots.getMeta(meta.reshootOf).catch(() => null) : meta;
  if (seat !== meta && (seat?.reshootId !== meta.id || seat.userId !== meta.userId)) return false;
  if (!viewer.teamId || seat?.team?.id !== viewer.teamId) return false;
  const team = await getTeam(viewer.teamId);
  if (team?.ownerId !== viewer.id) return false;
  const s = await shoots.get(meta.id);
  return !!s?.shots.some((x) => x.status === "done" && x.file === file);
}

// The admin deleted their account: the team and its open invite links go.
// Members keep their own shoots and headshots.
// A member deleted their account: the team keeps the row (the admin paid for
// the seat) but not their name or email address.
// Every team that lists this person (a deleted or returned seat leaves no shoot behind).
export async function forgetMemberEverywhere(userId) {
  if (!userId) return;
  for (const key of await list("teams/")) {
    const t = await getJSON(key).catch(() => null);
    if (t && Object.values(t.invites || {}).some((i) => i.userId === userId)) await forgetMember(t.id, userId);
  }
}
export async function forgetMember(teamId, userId) {
  if (!teamId || !userId) return;
  await updateJSON(teamKey(teamId), (t) => {
    const hit = Object.values(t.invites || {}).filter((i) => i.userId === userId);
    if (!hit.length) return UNCHANGED;
    const invites = { ...t.invites };
    for (const i of hit) invites[i.id] = { ...i, email: null, name: null, userId: null, forgotten: true, forgottenAt: new Date().toISOString() };
    return { ...t, invites };
  }).catch(() => null);
}

export async function removeTeam(teamId) {
  const team = await getTeam(teamId);
  if (!team) return;
  // Colleagues keep their seats (paid for when invited). A refund debt the
  // admin still carried marks that many undeveloped seats unpaid, newest
  // first, but only from refunded packages (or older seats with no package
  // recorded). Another package's paid seats stay paid, as they were while
  // the admin still had their account.
  const owner = await users.byId(team.ownerId).catch(() => null);
  let owed = owner?.creditsOwed || 0;
  const taken = Object.values(team.invites || {}).filter((i) => i.status === "joined" && i.shootId).sort((a, b) => String(b.joinedAt || "").localeCompare(String(a.joinedAt || "")));
  for (const inv of taken) {
    if (owed <= 0) break;
    if (inv.paidBy && !refundedPackage(owner, inv.paidBy)) continue;
    const marked = await shoots.updateMeta(inv.shootId, (m) => (seatSpent(m) || !m.team ? false : void (m.team = { ...m.team, unpaid: true }))).catch(() => null);
    if (marked) owed--;
  }
  // A refund after the admin's account is gone (lib/billing.js) can still
  // mark the seats its package paid for unpaid: keep which package paid for
  // each seat still undeveloped, and what each package had left unspent.
  const seats = [];
  for (const inv of taken) {
    if (!inv.charged || !inv.paidBy) continue;
    const meta = await shoots.getMeta(inv.shootId).catch(() => null);
    if (meta && !seatSpent(meta) && !meta.team?.unpaid) seats.push({ shootId: inv.shootId, paidBy: inv.paidBy, joinedAt: inv.joinedAt || "" });
  }
  // Refunds already applied count as handled, and what they took is added
  // back to "unspent", so a later, larger refund of the same package only
  // counts its new shoots (unpaySeatsOfGoneOwner works from the totals).
  const removed = {};
  for (const r of owner?.refunds || []) removed[r.sessionId] = (removed[r.sessionId] || 0) + (r.shootsRemoved || 0);
  const left = Object.fromEntries([...creditLots(owner || {}).left].map(([sid, n]) => [sid, n + (removed[sid] || 0)]));
  if (seats.length && owner) await putJSON(goneKey(team.ownerId), { seats, left, handled: removed }).catch((err) => console.error("[team] seat record", team.ownerId, err.message));
  // The admin's account is gone: their name goes from colleagues' shoots too.
  for (const inv of taken) await shoots.updateMeta(inv.shootId, (m) => (m.team?.ownerName ? void delete m.team.ownerName : false)).catch((err) => console.error("[team] owner name", inv.shootId, err.message));
  await del(Object.values(team.invites || {}).map((i) => inviteKey(i.token)));
  await del(teamKey(teamId));
}
const goneKey = (ownerId) => `teams/gone/${ownerId}.json`;

// A package refunded after the admin deleted their account: the shoots it
// refunds come out of what it had left unspent first; any more mark that
// many of the seats it paid for unpaid (newest first). Reserve the work before
// touching shoots, and keep it pending until the writes succeed: a failed or
// interrupted webhook can retry without selecting another seat for that refund.
export async function unpaySeatsOfGoneOwner(ownerId, sessionId, refundedShoots) {
  const key = goneKey(ownerId);
  const record = await updateJSON(key, (rec) => {
    if (!rec) return UNCHANGED;
    const pending = rec.pending?.[sessionId];
    const before = Math.max(rec.handled?.[sessionId] || 0, pending?.refundedShoots || 0);
    if (refundedShoots <= before) return UNCHANGED;
    const left = rec.left?.[sessionId] || 0;
    const due = Math.max(0, refundedShoots - left) - Math.max(0, before - left);
    const mark = rec.seats.filter((s) => s.paidBy === sessionId).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)).slice(0, due);
    return {
      ...rec, seats: rec.seats.filter((s) => !mark.includes(s)),
      pending: { ...rec.pending, [sessionId]: { refundedShoots, seats: [...(pending?.seats || []), ...mark] } },
    };
  });
  const pending = record?.pending?.[sessionId];
  if (!pending) return 0;
  let n = 0;
  for (const s of pending.seats) if (await shoots.updateMeta(s.shootId, (m) => (seatSpent(m) || !m.team ? false : void (m.team = { ...m.team, unpaid: true })))) n++;
  const done = new Set(pending.seats.map((s) => s.shootId));
  await updateJSON(key, (rec) => {
    const current = rec.pending?.[sessionId];
    if (!current) return UNCHANGED;
    // A concurrent larger refund may have reserved additional seats while we
    // wrote these. Acknowledge only this batch, leaving its extra work pending.
    const remaining = current.seats.filter((s) => !done.has(s.shootId));
    const waiting = { ...rec.pending };
    if (remaining.length) waiting[sessionId] = { ...current, seats: remaining };
    else delete waiting[sessionId];
    const handled = Math.max(rec.handled?.[sessionId] || 0, remaining.length ? pending.refundedShoots : current.refundedShoots);
    return { ...rec, pending: waiting, handled: { ...rec.handled, [sessionId]: handled } };
  });
  if (n) console.error(`[billing] refund ${sessionId}: ${n} team seat(s) from a deleted admin's account are no longer paid for`);
  return n;
}
