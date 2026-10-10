// Team orders: one person (the team admin) buys shoots and invites colleagues
// by email. Each invite sets aside one shoot from the admin's balance; the
// colleague accepts with their own account and gets a shoot that's already
// paid for and fixed to the team's look, so everyone matches. The admin sees
// each person's progress and can download their finished headshots (never
// their selfies). A cancelled invite, or a team shoot deleted before it's
// developed, gives the shoot back to the admin.
//
//   teams/<teamId>.json     { id, ownerId, ownerName, name, looks, invites: { <inviteId>: {...} } }
//   invites/<token>.json    { teamId, inviteId }  (the secret in the emailed link)

import crypto from "node:crypto";
import { createJSON, getJSON, updateJSON, del, UNCHANGED } from "./storage.js";
import { users, shoots, id } from "./store.js";
import { planFor, PlanError, creditSource } from "./plan.js";
import { lookFor, MAX_LOOKS } from "../public/js/shared/catalog.js";

export const MAX_INVITES = 100; // per team, over its lifetime

// Returns one credit to an account: a refund debt (lib/billing.js
// reconcileRefund) is settled before the balance grows.
export function giveBack(u) {
  if ((u.creditsOwed || 0) > 0) u.creditsOwed -= 1;
  else u.credits = (u.credits || 0) + 1;
  if (!u.creditsOwed) delete u.creditsOwed;
}
export const INVITE_TTL_DAYS = 90; // an unopened invitation lapses and gives the shoot back
const lapsed = (inv, now) => inv.status === "invited" && Date.parse(inv.invitedAt) + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000 < now;

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
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

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
  if (/https?:|www\.|[<>@]|\.(com|net|org|io|co|ly|me)\b/i.test(cleanName)) throw new PlanError("Use just your team's name (no links or email addresses).", "team_name", 400);
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
  if (addr === normEmail(owner.email)) throw new PlanError("That's your own address. Start a shoot for yourself from your dashboard instead.", "invite_self", 400);
  let team = await getTeam(owner.teamId);
  if (!team) throw new PlanError("Set up your team first.", "no_team", 400);
  if (await expireInvites(team)) team = await getTeam(owner.teamId);
  const open = Object.values(team.invites || {});
  if (open.some((i) => i.email === addr && ["invited", "joined"].includes(i.status))) throw new PlanError(`${addr} is already on the team.`, "invite_dup", 409);
  if (open.length >= MAX_INVITES) throw new PlanError(`A team can send up to ${MAX_INVITES} invites. Contact us for a larger team.`, "invite_max", 409);

  let paidBy = null;
  await users.update(owner.id, (u) => {
    paidBy = null;
    const p = planFor(u);
    if (p.tier === "owner") return UNCHANGED; // site owners aren't charged
    if (!(p.credits > 0)) throw new PlanError("You've no shoots left to give. Buy a package to invite more people.", "no_shoots_left");
    paidBy = creditSource(u);
    u.credits = p.credits - 1;
  });
  const charged = planFor(owner).tier !== "owner";
  try {
    const token = crypto.randomBytes(24).toString("base64url");
    const inv = { id: id("inv"), email: addr, token, status: "invited", invitedAt: new Date().toISOString(), sentAt: null, charged, ...(paidBy ? { paidBy } : {}) };
    let dup = false;
    const saved = await updateJSON(teamKey(team.id), (t) => {
      if (Object.values(t.invites || {}).some((i) => i.email === addr && ["invited", "joined"].includes(i.status))) return (dup = true), UNCHANGED;
      return { ...t, invites: { ...t.invites, [inv.id]: inv } };
    });
    if (dup) throw new PlanError(`${addr} is already on the team.`, "invite_dup", 409);
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
// deleted before it was developed. `from` is the status it must still have.
async function release(teamId, inviteId, from, to) {
  let inv = null;
  await updateJSON(teamKey(teamId), (t) => {
    inv = null; // the callback may run again after a write conflict
    const cur = t.invites?.[inviteId];
    if (!cur || cur.status !== from) return UNCHANGED;
    inv = cur;
    return { ...t, invites: { ...t.invites, [inviteId]: { ...cur, status: to, endedAt: new Date().toISOString() } } };
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
export const returnSeat = (meta) => (meta.team?.id && meta.team.inviteId ? release(meta.team.id, meta.team.inviteId, "joined", "returned") : false);

// Whether a team seat is still paid for: a refund that took back more credits
// than the admin had left (creditsOwed, lib/billing.js) leaves seats unpaid
// until invitations are withdrawn or a new package settles it.
export async function seatPaid(meta) {
  const team = meta.team?.ownerId ? meta.team : await getTeam(meta.team?.id);
  const owner = team && (await users.byId(team.ownerId));
  // The team is gone (the admin deleted their account): the seat was paid
  // for when the invitation was sent, unless removeTeam marked it unpaid.
  if (!owner) return !meta.team?.unpaid;
  return !((owner.creditsOwed || 0) > 0);
}

// How many of the admin's credits sit on team seats right now: open
// invitations and seats taken but not yet developed. A refund can only put
// those in debt (lib/billing.js reconcileRefund).
export async function seatsOnCredit(ownerId) {
  const owner = await users.byId(ownerId);
  const team = owner?.teamId && (await getTeam(owner.teamId));
  let n = 0;
  for (const inv of Object.values(team?.invites || {})) {
    if (!inv.charged) continue;
    if (inv.status === "invited") n++;
    else if (inv.status === "joined" && inv.shootId) {
      const meta = await shoots.getMeta(inv.shootId).catch(() => null);
      if (meta && ["draft", "checked"].includes(meta.status)) n++;
    }
  }
  return n;
}

// Withdraws the admin's open invitations, newest first, until the refund debt
// is settled (each one returned settles one credit). Returns how many.
export async function settleDebt(ownerId) {
  const owner = await users.byId(ownerId);
  let owed = owner?.creditsOwed || 0;
  if (!owed || !owner.teamId) return 0;
  const team = await getTeam(owner.teamId);
  const open = Object.values(team?.invites || {}).filter((i) => i.status === "invited" && i.charged).sort((a, b) => String(b.invitedAt).localeCompare(String(a.invitedAt)));
  let n = 0;
  for (const inv of open) {
    if (owed <= 0) break;
    if (await release(team.id, inv.id, "invited", "cancelled")) {
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
  if (normEmail(user.email) !== inv.email) throw new PlanError(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`, "invite_other_email", 403);
  if (inv.status === "joined" && inv.userId === user.id && inv.shootId) return { shootId: inv.shootId, team };
  if (inv.status !== "invited") throw new PlanError("This invitation has already been used or cancelled.", "invite_used", 409);
  if (inv.charged && !(await seatPaid({ team }))) throw new PlanError("This invitation isn't paid for any more. Ask your team admin for a new one.", "invite_unpaid", 409);

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
  await users.update(user.id, (u) => {
    if (u.emailVerified !== false) return UNCHANGED;
    u.emailVerified = true;
    u.emailVerifiedVia = "invite";
    u.emailVerifiedAt = now;
  });
  return { shootId: sid, team };
}

// The admin's view: every invite with its person's progress and, once done,
// the chosen headshot.
export async function teamStatus(owner) {
  let team = await getTeam(owner.teamId);
  if (!team) return null;
  if (await expireInvites(team)) team = await getTeam(owner.teamId);
  const members = await Promise.all(
    Object.values(team.invites || {})
      .filter((i) => i.status !== "cancelled")
      .sort((a, b) => String(a.invitedAt || "").localeCompare(String(b.invitedAt || "")))
      .map(async (i) => {
        const base = { id: i.id, email: i.email, status: i.status, name: i.name || null, invitedAt: i.invitedAt, sentAt: i.sentAt };
        if (i.forgotten) return { ...base, email: null, name: "Deleted account", status: "account_deleted" };
        if (i.status !== "joined" || !i.shootId) return base;
        const s = await shoots.get(i.shootId).catch(() => null);
        if (!s) return { ...base, status: "deleted" };
        const done = s.shots.filter((x) => x.status === "done");
        const pick = done.find((x) => x.id === s.pickedShotId) || done.find((x) => x.id === s.review?.bestShotId) || done[0] || null;
        return { ...base, shootId: s.id, shootStatus: s.status, selfies: s.selfies.length, done: done.length, pick: s.status === "done" && pick ? pick.file : null };
      }),
  );
  return { id: team.id, name: team.name, looks: team.looks, members };
}

// Whether `viewer` (a team admin) may download this file of a member's team
// shoot: finished headshots only, never the member's selfies.
export async function adminMayView(viewer, meta, file) {
  if (!viewer.teamId || meta.team?.id !== viewer.teamId) return false;
  const team = await getTeam(viewer.teamId);
  if (team?.ownerId !== viewer.id) return false;
  const s = await shoots.get(meta.id);
  return !!s?.shots.some((x) => x.status === "done" && x.file === file);
}

// The admin deleted their account: the team and its open invite links go.
// Members keep their own shoots and headshots.
// A member deleted their account: the team keeps the row (the admin paid for
// the seat) but not their name or email address.
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
  // first, the way settleDebt would have withdrawn invitations.
  const owner = await users.byId(team.ownerId).catch(() => null);
  let owed = owner?.creditsOwed || 0;
  const taken = Object.values(team.invites || {}).filter((i) => i.status === "joined" && i.shootId).sort((a, b) => String(b.joinedAt || "").localeCompare(String(a.joinedAt || "")));
  for (const inv of taken) {
    if (owed <= 0) break;
    const marked = await shoots.updateMeta(inv.shootId, (m) => ((m.shots || []).length || !m.team ? false : void (m.team = { ...m.team, unpaid: true }))).catch(() => null);
    if (marked) owed--;
  }
  await del(Object.values(team.invites || {}).map((i) => inviteKey(i.token)));
  await del(teamKey(teamId));
}
