// Deleting an account (POST /api/account/delete) after the erasure marker is
// written: everything the account holds goes. The route runs it straight
// away; the daily clean-up (lib/cleanup.js) finishes one that stopped partway
// (a storage time-out), so it never stays "being deleted". Every step is safe
// to run again, and safe when its part is already gone.

import { users, shoots } from "./store.js";
import { del } from "./storage.js";
import * as teams from "./teams.js";
import * as showcase from "./showcase.js";
import * as reviews from "./reviews.js";
import { STEPS } from "./stats.js";

// `known`: the account record, when the caller has it (the route); otherwise
// it's read, and may already be gone (the deletion stopped after removing it).
export async function finishDeletion(uid, known = null) {
  // Revoke work before listing: concurrent uploads, develops and late workers
  // must not restore photos after their account has requested erasure.
  await users.beginRemoval(uid);
  const user = known || (await users.byId(uid)) || { id: uid };
  const list = await shoots.forUser(uid);
  // An undeveloped team shoot goes back to its team; your own team closes.
  for (const meta of list) if (meta.team && !(meta.shots || []).length) await teams.returnSeat(meta).catch((err) => console.error("[team] return seat", meta.id, err.message));
  if (user.teamId) await teams.removeTeam(user.teamId);
  // Teams they were a member of keep the seat, not their name or address.
  await teams.forgetMemberEverywhere(uid);
  await showcase.removeForUser(uid);
  await reviews.remove(uid);
  await users.remove(user);
  // The funnel keeps its day totals; the per-person "already counted" markers go.
  await del(STEPS.map((step) => `stats/seen/${step}/${uid}.json`)).catch((err) => console.warn("[stats]", err.message));
}
