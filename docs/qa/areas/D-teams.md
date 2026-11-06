# D-teams audit (prefix zz-d4, ports 3614/4614/2614), main @ d1c7ac7

How I tested:
- Ran the existing suites against my own stack. `team-tests.js` passed 62/62 with FREE_SHOOT_OFFERED=1, which is how ci.sh runs it. With the production setting (FREE=0) it reports 2 FAILs and then crashes. Both FAILs and the crash come from tests that assume the free shoot exists, so they are not product bugs.
- `billing-team-refund-tests.js` passed 11/11.
- Wrote my own API scripts (zz-d4-a/b/d/e) and a Playwright run at 390px (zz-d4-c). All of these ran with FREE_SHOOT_OFFERED=0, which matches production. The scripts are deleted.

## 1. Inventory

| # | Item | How checked | Result |
|---|---|---|---|
| 1 | GET /api/team: signed out | script | OK (401) |
| 2 | GET /api/team: account with no team | script | OK (team null, credits 12) |
| 3 | GET /api/team: admin; lapses expired invites and returns a fresh user | script + suite | OK |
| 4 | GET /api/team: stranger or member | script | OK (team null) |
| 5 | POST /api/team: demo, needsEmail, or address not owned | code read + script | OK for demo and unconfirmed; see D-03 for invite-confirmed accounts |
| 6 | POST /api/team: name rules (links, @, <>, address-like, zero-width, blank, 60-char cap) | script | OK |
| 7 | POST /api/team: looks (none or invalid gives 400; more than 4 are trimmed to 4; duplicates removed) | script | OK. An invalid look in a list is dropped silently; the UI only sends valid ones. |
| 8 | POST /api/team: two tabs creating at once | code read | OK (first team wins, the other team file is deleted) |
| 9 | POST /api/team: update name or looks after people joined | script + browser | **D-02** |
| 10 | POST /api/team/invites: empty list, separators, dedupe | script | OK |
| 11 | POST /api/team/invites: more than 25 addresses | script | **D-01** |
| 12 | invite(): bad address, own address in any case, duplicate (also in one batch with different case) | script + suite | OK |
| 13 | invite(): no credits; creditsOwed (seats_unpaid); owner tier not charged | script + suite + code | OK. With 0 credits and a debt, the generic "no shoots left" message is shown (part of D-05). |
| 14 | invite(): MAX_INVITES 100 over the team's lifetime | code read | Counts cancelled and expired invites too; noted under D-08 |
| 15 | invite(): hourly limit of 30 counted per address across batches | suite | OK |
| 16 | invite(): failure after the charge gives the credit back | code read | OK |
| 17 | Gmail dot or plus variants of one inbox | script | **D-08** (low) |
| 18 | sendInvite: mail off, 3 emails a day per address, provider error | suite + code | OK. A provider error on Resend gives a generic 500 (low, not filed). |
| 19 | POST /invites/:id/resend: 60s guard, cap, stranger, not open | script + suite | OK |
| 20 | Resend of an invite past 90 days that has not been expired yet | script | **D-06** |
| 21 | GET /invites/:id/link: owner check, not open | script | OK. Lapsed invites: **D-06** |
| 22 | DELETE /invites/:id: open, accepted (409), unknown, stranger | script + suite | OK. A stranger or unknown id gets the 409 "already accepted" wording; trivial. |
| 23 | GET /api/join/:token: bad, unknown, cancelled, lapsed, joined (mine / not mine) | script + suite | OK. The page exposes the invited address to anyone who has the token; acceptable because the token is secret. |
| 24 | POST /api/join/:token: demo, other email, used, unpaid, accept twice, race | suite + code | OK |
| 25 | accept(): password account, Google-only account, unconfirmed account (marked verified via invite), owner email (no owner tier) | script + suite | OK |
| 26 | accept(): demo address invited | code read | OK. The route returns 403 demo_read_only; the admin can cancel and get the shoot back. |
| 27 | Member on two teams (joinedTeam, teamSeatReturned, otherTeamShoot) | script + suite | OK |
| 28 | Team shoot through develop: team looks forced, member not charged, check not counted | script + suite | OK |
| 29 | Seat unpaid after a refund: develop 402, check, retries/reshoot (paidForRefunded) | script + suite | OK |
| 30 | Member deletes shoot before develop: returnSeat, credit back, "Shoot returned" | suite | OK |
| 31 | Member deletes a developed shoot: "Shoot deleted" | code read | OK |
| 32 | Member deletes account (before or after develop): seat returned, forgotten everywhere | suite | OK |
| 33 | Admin deletes account: removeTeam, links dead, seats stay paid, owner name removed, gone record | script + suite | OK |
| 34 | Member deletes their seat after the admin deleted their account | script | OK (no error; teamMember cleared) |
| 35 | Admin refund of a team package, partial (1 of 3 shoots) | script | OK on the server (open invite withdrawn). Admin-facing messages: **D-05** |
| 36 | Admin refund of a team package, full, with a taken seat | script + suite | OK on the server (seat unpaid, 402). Admin-facing messages: **D-05** |
| 37 | New package settles the debt; seat develops again | script | OK on the server. Purchase toast count: **D-04** |
| 38 | seatPaid / refundedPackage / paidWith / seatsOnCredit / settleDebt / unpaySeatsOfGoneOwner | suites (billing-team-refund 11/11, team 9b–9f2) | OK |
| 39 | Invite expiry (lazy lapse at 90 days) | script | **D-06** |
| 40 | adminMayView: done shots only, never selfies or held-back frames, stranger | suite + code | OK |
| 41 | forgetMemberEverywhere (lists all teams/ including gone/) | code read | OK. Cost is O(number of teams) per account deletion; noted only. |
| 42 | Invite email (subject, from, reply-to, text, looks, 90 days, privacy line, address-like name fallback) | script | OK. Owner name after a rename: **D-07** |
| 43 | teamadmin.js setup page (copy, look limit "up to 4; 2 headshots per look") | browser | OK |
| 44 | teamadmin.js chip "N shoots to give" after invite and cancel; owner "unlimited" | browser + code | OK (12 → 10 → 11) |
| 45 | teamadmin.js invite toasts (sent, created, capped, bad) | browser | OK |
| 46 | teamadmin.js cancel toast (back / went to refund / owner) | browser + code | OK |
| 47 | teamadmin.js lock banners (demo, needsEmail, unconfirmed) | code + browser | Invite-confirmed accounts: **D-03** |
| 48 | teamadmin.js 0-credit prompt "Buy Executive (12 shoots)" with return=team | code read | OK |
| 49 | teamadmin.js "People N" count | browser | Includes returned, expired and deleted rows (cosmetic; not filed) |
| 50 | teamadmin.js "Download N headshots" | — | known (saves 2 files; only the best pick) |
| 51 | teamadmin.js status badges for every status | code read | OK |
| 52 | team.js prices at the sale prices: $14.50/3 = $4.83, $19.50/6 = $3.25, $24.50/12 = $2.04; "~$2", "About $2"; was-prices $29/$39/$49 | browser | OK |
| 53 | team.js / TEAM_FAQ promise "everyone's finished headshots" | — | known |
| 54 | team.js / TEAM_FAQ other promises (90-day lapse, cancel gives back, deleted before develop goes back, unused shoots don't expire) | script + suite | OK. The lapse returns the shoot only lazily: D-06. |
| 55 | join.js: no token, invalid, used, signed out (signup/signin keep next and email), wrong account, accept, mine → redirect | browser + suite | OK. Stale owner name: D-07 |
| 56 | Google sign-in or sign-up from /join returns to /join | script | OK |
| 57 | dashboard.js team banner ("Your team has paid…") and the noShoots case | browser + code | OK |
| 58 | studio.js team looks step (owner name or "Your team admin", N headshots = looks × 2) | code + suite | OK. Owner name: D-07 |
| 59 | studio.js held-back-frames dialog and free reshoot for team shoots | code read | **D-09** |
| 60 | Download wording: page, FAQ, account page and team page say "each person's chosen headshot" | browser + suite | OK (6 Nov) |
| 61 | Look warning: only after joins; for look, name or both; not for spaces only | browser | OK; going back to the joined look still warns (low, open) |
| 62 | Name warning: says joined shoots keep the name they were set up with | browser | fixed 6 Nov (named the current name, not theirs) |
| 63 | Heading: "Everyone gets" changes to "New joiners get" after a look change and back after reverting; a rename alone doesn't | browser + suite | OK |
| 64 | Refund note: banner, "Withdrawn · refund" and "Unpaid since your refund" badges; banner 30 days; cleared when the debt is settled | API + browser + suite | OK; a re-invited address still shows its withdrawn row (low, open) |
| 65 | Team free reshoot: 2+ likeness holds, once, team looks, no charge; admin sees and downloads it; refused after a full refund | suite | OK |
| 66 | moveSeat: deleting the original moves the seat to the reshoot (seatUsed), no shoot back, no second reshoot; not after a full refund | reshoot-tests | fixed 6 Nov (after a refund it gave a free develop) |
| 67 | Gmail variants: a variant is refused as a duplicate and as the admin's own; trailing-dot domain refused as duplicate | script | OK |
| 68 | inviteFor: a variant accepts only once confirmed; outside Gmail a +tag is a different address | team-tests | fixed 6 Nov (+tags matched at every provider) |
| 69 | Live-only 100 cap; at most 300 invitations stored in all (invite-and-cancel loops) | team-tests 9k | fixed 6 Nov (the 300 ceiling) |
| 70 | Over 25 addresses: 400 with a count; the textarea keeps the text | API + code | OK |
| 71 | Lapsed invite resend or link: 404, shoot comes back | API | OK |
| 72 | Purchase after a refund debt: added is the net amount | API | OK |
| 73 | Join page for an unconfirmed other spelling shows "Start" and only then says to confirm | browser | low, open |
| 74 | billing-team-refund-tests binds port 0 (not runnable inside reviewers' port ranges) | - | note |

Items checked on 6 Nov (rotation): 74 (59 + 15 new).

## 2. Findings

### D-01 (low, bug): addresses past the 25th in one paste are dropped without any message
- **Repro:** Admin with 12 credits posts 30 addresses to /api/team/invites. The response has `results.length === 25` and nothing for the other 5. In the UI the textarea is cleared; only failed addresses are put back, so the 5 vanish.
- **Where:** server.js:1436 (`.slice(0, 25)`).
- **Fix:** Return `{email, ok:false, error:"Up to 25 addresses at a time"}` for the overflow, or return a 400 when there are more than 25.
- **Reproduced:** yes (script).

### D-02 (medium, bug or owner decision): changing the team's looks or name doesn't reach people who already joined, but the page says everyone gets the new look
- **Repro:** Team "Acme" with Studio Gray · Navy Suit. A member accepts. The admin uses "Change" and saves Library · Camel Knit and the name "Acme Corp". The member's shoot still has `team.looks` = Studio Gray / Navy Suit and the name "Acme headshot", and it develops in Studio Gray. The admin page now says "Everyone gets Library · Camel Knit". The setup form gives no warning.
- **Impact:** The team doesn't match, which is the product's main promise for teams. The admin doesn't know.
- **Where:** lib/teams.js:88 (only the team file is updated). lib/teams.js:304 (looks are copied when someone accepts). server.js:1004 (develop uses meta.team.looks).
- **Fix:** In saveTeam, also update `team.looks` and `team.name` on joined members' shoots that haven't been developed yet (no shots). Or show a warning on the form: "People who've already joined keep the old look".
- **Reproduced:** yes (script).

### D-03 (medium, bug): an account confirmed only by a team invitation can't set up a team, and the instructions lead nowhere
- **Repro:** Sign up without confirming, accept an invitation (the account becomes emailVerified with emailVerifiedVia "invite"), then open /app/team. The Create team button is enabled. Clicking it shows "Confirm your email address before setting up a team: enter the 6-digit code from our email on your Account page." The Account page has no code box, because `u.emailVerified` is true.
- **Impact:** A member who wants to order for their own team is stuck. The API would accept a resend or a code, but the UI offers neither.
- **Where:** public/js/views/account.js:61 and teamadmin.js:54 use `emailVerified`; the server checks `ownsMailbox` (server.js:1395, lib/auth.js:288).
- **Fix:** Add `ownsMailbox` (or `emailVerifiedVia`) to publicUser, and use it for the Account verify panel and for lockedNow in teamadmin.js.
- **Reproduced:** yes (API and browser at 390px; verify panel count 0).

### D-04 (low, bug): after a refund debt, the purchase toast overstates the shoots added
- **Repro:** A full refund leaves one taken seat unpaid (creditsOwed 1). The admin buys Starter. /api/billing/confirm returns `added: 3`, so the toast says "3 shoots added to your account", but credits go from 0 to 2.
- **Where:** lib/billing.js:183-185 settles the debt; fulfil returns the package's `shoots` (billing.js:216/218); dashboard.js:123.
- **Fix:** Return the net added (`shoots - settle`) and mention the settled seat in the toast.
- **Reproduced:** yes (script).

### D-05 (medium, owner decision): the admin isn't told what a refund did to their team
- **Repro:** Starter bought at full price; 3 invites; x checked, y developed, z open. A partial refund ($5) withdraws z's invitation, and z disappears from People because cancelled rows are filtered out. The full refund then makes x's seat unpaid; x gets 402 "Ask your team admin to buy a package". In both cases `refundNotice` is 0. The team page still shows x as "Photos checked" with no warning. The invite error says "no shoots left" rather than explaining the unpaid seat.
- **Impact:** The admin doesn't know a colleague is blocked or why an invitation vanished.
- **Where:** lib/auth.js:296 (the notice counts only creditsTaken); teamadmin.js (has no debt or unpaid state); lib/teams.js:332 (cancelled rows hidden).
- **Fix:** Expose `creditsOwed` and a per-member `unpaid` flag in teamStatus. Show a banner like "N seats aren't paid for since your refund: buying a package settles them". Show withdrawn invites as "Withdrawn (refund)".
- **Reproduced:** yes (script). The UI side is from reading the code.

### D-06 (low, bug): invitation lapse happens only when something triggers it, so some paths show stale state
- **Repro:** Set an open invite's invitedAt to 91 days ago.
  - /api/me still shows 2 credits until the team page, an invite, or the join link is opened; then it shows 3.
  - GET /invites/:id/link returns 200 with a link, and opening that link gives 404.
  - POST /resend on the lapsed invite returns 200 and resets invitedAt, so the invitation comes back to life.
- **Where:** lib/teams.js:50-58 (lazy lapse); server.js:1459-1477 (resend and link don't check `lapsed`).
- **Fix:** Call `expireInvites` in resend and link (return 404 when lapsed), or run it from the daily cleanup job. Owner: decide whether a resend should revive an invite.
- **Reproduced:** yes (script, by editing the data file).

### D-07 (low, bug): the join page and studio show the admin's old name after a rename
- **Repro:** Admin "Del Admin" renames to "Delia Newname" in Account. The new invitation email says "Delia Newname invited you…", but /api/join (and the studio lede) say "Del Admin".
- **Where:** lib/teams.js:90 stores ownerName once; server.js:1409 uses req.user.name; join.js:209; studio.js:570.
- **Fix:** Read the owner's current name in GET /api/join, or update team.ownerName when the name changes.
- **Reproduced:** yes (script).

### D-08 (low, owner decision): invitation matching is exact-address only, and the 100-invite cap counts cancelled and expired invites
- **Repro:** Invite `g.g…@gmail.com`. The person signs in with Google as `gg…@gmail.com` (the same inbox) and gets 403 "This invitation was sent to g.g…". The two variants can also both be invited, which costs 2 credits.
- **Second issue:** MAX_INVITES (100) counts every status, so re-inviting after cancellations or lapses uses up the lifetime cap.
- **Where:** lib/teams.js:116, 117, 272.
- **Fix:** Compare with canonicalEmail (already used for the mail cap), and count only invited and joined invites toward the cap (or say "100 in total" in the UI).
- **Reproduced:** yes for the Gmail variant (script). The cap is from reading the code.

### D-09 (medium, owner decision): team members get no free reshoot, and the help dialog sends them toward buying
- **What happens:** A team shoot with 2+ frames held back for likeness is refused a reshoot (server.js:1262 `shoot.team` → "Contact us"). The selfie-tips dialog (studio.js:817/828) also hides the free "Retry the held-back frames" button for team shoots, though retries work in the API and on the develop page. Its main button is "Start a new shoot with new selfies" → /app/new, which needs a package of the member's own.
- **Impact:** This contradicts the general promise of a free reshoot when 2+ frames are held back. The team copy and FAQ don't mention the exception.
- **Fix:** Allow the reshoot for team shoots (using the same seat), or link team members to Contact and show the retry button.
- **Reproduced:** no (code read only; the mock doesn't produce likeness holds on demand).

### Known items met (not re-reported)
- Team page and FAQ promise "everyone's finished headshots" but only the best pick is downloadable.
- Admin "Download N headshots" saves 2 files.
