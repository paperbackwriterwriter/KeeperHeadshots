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
import { planFor, PlanError } from "./plan.js";
import { lookFor, MAX_LOOKS } from "../public/js/shared/catalog.js";

export const MAX_INVITES = 100; // per team, over its lifetime
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
  const cleanName = String(name || "").trim().slice(0, 60);
  const cleanLookList = cleanLooks(looks);
  if (!cleanName) throw new PlanError("Give your team a name.", "team_name", 400);
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
  const team = await getTeam(owner.teamId);
  if (!team) throw new PlanError("Set up your team first.", "no_team", 400);
  const open = Object.values(team.invites || {});
  if (open.some((i) => i.email === addr && ["invited", "joined"].includes(i.status))) throw new PlanError(`${addr} is already on the team.`, "invite_dup", 409);
  if (open.length >= MAX_INVITES) throw new PlanError(`A team can send up to ${MAX_INVITES} invites. Contact us for a larger team.`, "invite_max", 409);

  await users.update(owner.id, (u) => {
    const p = planFor(u);
    if (p.tier === "owner") return UNCHANGED; // site owners aren't charged
    if (!(p.credits > 0)) throw new PlanError("You've no shoots left to give. Buy a package to invite more people.", "no_shoots_left");
    u.credits = p.credits - 1;
  });
  const charged = planFor(owner).tier !== "owner";
  try {
    const token = crypto.randomBytes(24).toString("base64url");
    const inv = { id: id("inv"), email: addr, token, status: "invited", invitedAt: new Date().toISOString(), sentAt: null, charged };
    let dup = false;
    const saved = await updateJSON(teamKey(team.id), (t) => {
      if (Object.values(t.invites || {}).some((i) => i.email === addr && ["invited", "joined"].includes(i.status))) return (dup = true), UNCHANGED;
      return { ...t, invites: { ...t.invites, [inv.id]: inv } };
    });
    if (dup) throw new PlanError(`${addr} is already on the team.`, "invite_dup", 409);
    await createJSON(inviteKey(token), { teamId: team.id, inviteId: inv.id });
    return { team: saved, invite: inv };
  } catch (err) {
    if (charged) await users.update(owner.id, (u) => (u.credits = (u.credits || 0) + 1)).catch((e) => console.error("[team] refund after failed invite", owner.id, e.message));
    throw err;
  }
}

export const markSent = (teamId, inviteId) =>
  updateJSON(teamKey(teamId), (t) => (t.invites?.[inviteId] ? { ...t, invites: { ...t.invites, [inviteId]: { ...t.invites[inviteId], sentAt: new Date().toISOString() } } } : UNCHANGED));

// Gives an unused shoot back to the admin: a cancelled invite, or a team shoot
// deleted before it was developed. `from` is the status it must still have.
async function release(teamId, inviteId, from, to) {
  let inv = null;
  await updateJSON(teamKey(teamId), (t) => {
    const cur = t.invites?.[inviteId];
    if (!cur || cur.status !== from) return UNCHANGED;
    inv = cur;
    return { ...t, invites: { ...t.invites, [inviteId]: { ...cur, status: to, endedAt: new Date().toISOString() } } };
  });
  if (!inv) return false;
  const team = await getTeam(teamId);
  if (inv.charged) await users.update(team.ownerId, (u) => (u.credits = (u.credits || 0) + 1));
  await del(inviteKey(inv.token)).catch(() => {});
  return true;
}
export const cancelInvite = (owner, inviteId) => release(owner.teamId, inviteId, "invited", "cancelled");
// A team shoot deleted by its member before developing.
export const returnSeat = (meta) => (meta.team?.id && meta.team.inviteId ? release(meta.team.id, meta.team.inviteId, "joined", "returned") : false);

export async function readInvite(token) {
  if (!/^[\w-]{20,60}$/.test(String(token || ""))) return null;
  const ref = await getJSON(inviteKey(token));
  const team = ref && (await getTeam(ref.teamId));
  const inv = team?.invites?.[ref.inviteId];
  return inv && inv.token === token ? { team, invite: inv } : null;
}

// The invited person accepts, signed in with the invited address. Creates
// their team shoot (once; accepting again returns the same shoot).
export async function accept(user, token) {
  const found = await readInvite(token);
  if (!found) throw new PlanError("This invitation isn't valid any more. Ask your team admin for a new one.", "invite_invalid", 404);
  const { team, invite: inv } = found;
  if (normEmail(user.email) !== inv.email) throw new PlanError(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`, "invite_other_email", 403);
  if (inv.status === "joined" && inv.userId === user.id && inv.shootId) return { shootId: inv.shootId, team };
  if (inv.status !== "invited") throw new PlanError("This invitation has already been used or cancelled.", "invite_used", 409);

  const sid = id("sht");
  let won = false;
  await updateJSON(teamKey(team.id), (t) => {
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
    team: { id: team.id, inviteId: inv.id, name: team.name, ownerName: team.ownerName, looks: team.looks },
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
  const team = await getTeam(owner.teamId);
  if (!team) return null;
  const members = await Promise.all(
    Object.values(team.invites || {})
      .filter((i) => i.status !== "cancelled")
      .sort((a, b) => a.invitedAt.localeCompare(b.invitedAt))
      .map(async (i) => {
        const base = { id: i.id, email: i.email, status: i.status, name: i.name || null, invitedAt: i.invitedAt, sentAt: i.sentAt };
        if (i.status !== "joined" || !i.shootId) return base;
        const s = await shoots.get(i.shootId).catch(() => null);
        if (!s) return { ...base, status: "returned" };
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
export async function removeTeam(teamId) {
  const team = await getTeam(teamId);
  if (!team) return;
  await del(Object.values(team.invites || {}).map((i) => inviteKey(i.token)));
  await del(teamKey(teamId));
}
