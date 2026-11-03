# Area G: emails and scheduled jobs (auditor zz-g7, ports 3617/4617/2617)

Repo /home/user/keeperheadshots @ d1c7ac7. Stack started with a copy of start-stack.sh that also sets CRON_SECRET, ALERTS=on and ALERT_GATHER_MS=3000 (scratchpad/audit/g7-stack.sh), FREE_SHOOT_OFFERED=0. Data dir <temp dir>
Throwaway scripts (all deleted afterwards): zz-g7-mail.mjs (renders every email variant with hostile input), zz-g7-seed.mjs (crafted records for cleanup and reminders), zz-g7-restore*.mjs (backup, deletion, restore), zz-g7-offer.mjs, zz-g7-funnel.mjs, zz-g7-alert.mjs, zz-g7-take.mjs, zz-g7-links.mjs / zz-g7-buylink.mjs (Playwright).
Outputs: scratchpad/audit/g7out/*.out, g7out/buylink-390.png.

Existing suites run against my stack: cleanup 14/14, backup 19/19, backup-retry 13/13, photo-backup 28/28, alert 4/4, blog 61/61, verification 9/9, reset 24/24, verification-delivery 22/22, takeover 11/11, reminder 51/52, team 58/60, growth and showcase crashed. Every failure comes from the suite expecting FREE_SHOOT_OFFERED=1 (ci.sh exports it), not from a bug. (Slip on my part: I started scripts/dev/durable-shoot-tests.js once before I saw that it opens fixed ports 4015, 3215 to 3217 and 2535. It exited within about a minute and left no process behind.)

## 1. Inventory

### Emails (lib/mail.js and callers)

| # | Item | How checked | Result |
|---|---|---|---|
| E1 | Verification, with a code (signup server.js:218, resend :552): trigger, recipient, subject carries the code, log masks the code | script render + live mail via the verification suites | OK |
| E2 | Verification without a code: text and HTML wording | script render | OK |
| E3 | Verification: "code and link work for 3 days" against lib/auth.js VERIFY_TTL (3 days) and the code window (sent day + 3) | code read | OK |
| E4 | Verification From/To: "Keeper Headshots" <hello@>, display name quoted, quotes and angle brackets stripped | live mock-mail | OK |
| E5 | Password reset: sent in the background after a constant response, demo excluded, 3 an hour and 1 a minute | code read + reset suite 24/24 | OK |
| E6 | Reset wording "1 hour and only once" against RESET_TTL and the signature covering the password hash | code read | OK |
| E7 | Team invite: trigger (/api/team/invites, resend), recipient = invitee, Reply-To = admin, link /join/<token> opens the join page | live mock-mail + Playwright | OK |
| E8 | Invite: admin or team name that reads like an address falls back to "Your team admin" / "team" | script render | OK |
| E9 | Invite: "works for 90 days" against INVITE_TTL_DAYS, and a resend restarts the 90 days | code read + cleanup run | OK |
| E10 | Invite: 1 look / several looks wording; an empty look list can't happen (saveTeam requires one) | script render + code read | OK |
| E11 | Invite: 3 emails a day per inbox | team suite | OK |
| E12 | Reminder "develop", needsPackage variant | live cron + render | OK |
| E13 | Reminder "develop", plain | live cron | OK |
| E14 | Reminder "develop", team variant | live cron (r14) | OK |
| E15 | Reminder "checkout": package, sale price ($14.50 from pkg.price), link /app/buy/<pkg> | live cron + Playwright | G7-06 (signed-out link lands on "Create your account") |
| E16 | Reminder "buy" (legacy free shoot, not a preview) | live cron (r15) | OK |
| E17 | Reminder "buy", preview variant | live cron (r16) + render | **G7-01** ("Packages from $29") |
| E18 | Reminders: unsubscribe link + postal address in HTML and text; List-Unsubscribe and List-Unsubscribe-Post headers | live mock-mail | OK |
| E19 | Offer email, 4 variants (usedFree, preview, checked, new) | render + live send | OK (wording depends on the owner typing "30% off", as the placeholder shows) |
| E20 | Offer: unsubscribe link and headers, postal address, signature, replies to hello@ | live send | OK |
| E21 | Offer recipients: confirmed, reminders on, never bought, not on a team, one per canonical inbox, never twice | live send (o1 to o9) | **G7-02** (one half-deleted account aborts the whole send) |
| E22 | Ready email: once per shoot, not for samples, demo, a deleting account, or an unconfirmed address that hasn't paid | code read + suites (verification-delivery, durable) | OK |
| E23 | Ready email: shoot name only to an inbox the account has proved is its own (ownsMailbox) | code read | OK |
| E24 | Ready email variants (graded/ungraded, preview, 1 or many) | render | G7-09 (cosmetic: "Download them" for 1 headshot) |
| E25 | Ready email preview prices $8.99 / $14.99 against PREVIEW_OFFERS | render + catalog | OK |
| E26 | Owner alert email (lib/alert.js): batching, Node warnings skipped, subject and text | live (3 alerts during suite runs) + alert suite | OK |
| E27 | Alert limits 4 an hour / 10 a day "across all servers" | script with 8 module instances | **G7-04** |
| E28 | Showcase notification to the owner: only on first offer, plain text, cleaned name, review link /app/showcase | live mock-mail + code read | OK |
| E29 | Contact form email: stored first, plain text, Reply-To = sender, subject/name cleaned (no CR/LF) | live POST with a hostile name | G7-08 (address check lets through characters a Reply-To can't carry) |
| E30 | Contact copy to the sender | code read | none exists (not promised anywhere) |
| E31 | Purchase receipt from the app | code read | **G7-07** (privacy says Resend sends receipts; the app sends none) |
| E32 | HTML escaping of every user-supplied field (name, team, shoot name, discount, until, link) in every variant | render with `<img onerror>`, `&`, quotes | OK (all escaped; links escaped in href) |
| E33 | Plain-text and HTML versions say the same thing | render, side by side | OK |
| E34 | Consistency with the site: guarantee "first package", 4 looks / 8 headshots, one-time payment, sale price | render vs catalog.js | G7-01 |
| E35 | Unsubscribe: page asks for a click first; one-click POST; bad/forged token → 400; deleted account → 404; nothing created for an unknown uid | curl + Playwright | OK |
| E36 | Account-page switch and unsubscribe page wording cover offers too | code read | OK |
| E37 | Every link in sent emails resolves (pricing, shoot, buy, verify, reset, join, unsubscribe, showcase) | Playwright over mock-mail links | OK, except G7-06 |
| E38 | Never to unconfirmed / unsubscribed / deleted where that matters: reminders, offers, ready | live cron + offer run | OK, except G7-02 |
| E39 | sendMail logging masks recipient and code; Resend timeout 15 s; SMTP timeouts | code read | OK |

### Scheduled jobs

| # | Item | How checked | Result |
|---|---|---|---|
| J1 | cronOnly: no or short secret → 404; wrong bearer → 404 | curl | OK |
| J2 | Cleanup: orphan media/shots deleted | crafted sht_g7orphan + cron | OK |
| J3 | Cleanup: draft 91 days deleted with its photos and a cancelled marker; 89 days kept; developed 200 days kept; sample 300 days kept | crafted c1 to c5 + cron | OK |
| J4 | Cleanup: an abandoned draft with a develop charge memo gives the credit back | c2: credits 0→1, memo cleared | OK |
| J5 | Cleanup: abandoned team draft returns the seat (invite "returned", admin +1, member teamSeatReturned) | crafted team + cron | OK |
| J6 | Cleanup: contact messages older than 365 days deleted, 300 days kept | crafted + cron | OK |
| J7 | Cleanup: rate-limit counters (hour, quarter-hour, day names) older than 2 days deleted, current kept; all windows in use are ≥15 min so names always match | crafted + cron + grep of every overLimit/withCounter | OK |
| J8 | Cleanup: invitation older than 90 days expires, token deleted, admin +1; recent kept | crafted + cron | OK |
| J9 | Cleanup: stuck shoot ("checking" > 15 min) advanced to draft with a timeout message | crafted + cron | OK |
| J10 | Cleanup: takeover resume (purges the earlier holder's draft, keeps the new holder's, drops selfies on a developed shoot, clears marker and flag) | crafted + cron | OK |
| J11 | Cleanup: photo-backup maintenance and backup expiry also run here; stale backup alert | code read + backup suites | OK |
| J12 | Cleanup: time budget (180 + 30 + 60 s against maxDuration 300) | code read | G7-10 (team, contact and rate-limit steps have no deadline) |
| J13 | Cleanup: resume cursor, a damaged record doesn't stop the run | cleanup suite | OK |
| J14 | Reminders: windows develop 1–14 d, checkout 1–7 d, buy 2–21 d | reminder suite + crafted r11 (20 d → none) | OK |
| J15 | Reminders: at most two (develop + checkout or buy); second on the next run; nothing twice | two cron runs (r12 got develop, then checkout; third run none) | OK |
| J16 | Reminders: excluded = unconfirmed, invite-confirmed, remindersOff, demo, owner, retake verdict, deleting account | crafted r2 to r6, r17, r18, r19 | OK |
| J17 | Reminders: claim before send, hand back on failure, daily limit + cursor | code read + reminder suite | OK |
| J18 | Backup: completeness of PREFIXES against every storage prefix the code writes | grep of every key prefix + snapshot inspection | **G7-05** (stats/refunds/ and takeovers/ missing) |
| J19 | Backup: snapshot complete, photo copies (61) with manifest, incomplete runs go to backups/incomplete | live cron/backup + suites | OK |
| J20 | Backup: 30-day expiry (capped), 7-day photo copies, erasure markers mirrored | suites | OK |
| J21 | Restore never resurrects deleted data: deleted account, deleted shoot, removed photo | live backup → account delete via API, shoot.remove, deleteMedia → restore --apply --photos | **G7-03** (account's funnel markers and develop claim come back); photos/records otherwise OK |
| J22 | Restore skips expired contact messages; missing-only by default; --overwrite is explicit | backup suite + code read | OK |
| J23 | Restore of a revoked invite token is harmless (team record governs) | code read | OK |
| J24 | Blog sync cron: no feed → skipped; sanitizing, unpublish, empty-feed safety, private addresses refused | curl + blog suite 61/61 | OK |
| J25 | Shoots cron (/api/cron/shoots): quiet when idle | curl | OK (deeper coverage is in durable-shoot-tests, which I didn't run: fixed ports) |
| J26 | Outreach reviewShoots (owner only, masked emails) | code read | OK |
| J27 | Outreach send: Stripe code checked first, dry run, cap 60 a run, 300 ms pacing, 429 stops | live owner run + code read | OK except G7-02 |
| J28 | Stats funnel: owner/demo not counted, counted once per person, refunds and won disputes | code read | OK |
| J29 | Stats funnelReport date window | script with a faked clock | **G7-11** (DST duplicates/skips a day) |
| J30 | Alerts: on in production or ALERTS=on, off with ALERTS=off, mail-failure path doesn't recurse | code read + alert suite | OK |

Known items met: none of the brief's known items came up in this area.

## 2. Findings

**G7-01 (medium, bug): the preview "buy" reminder quotes the old package price.**
Repro: zz-g7-mail.mjs `reminderEmail({kind:"buy", preview:true})`. A live cron run sent it to r16preview. Text: "Want more shoots? Packages from $29 include it too". HTML: "Packages with more shoots start at $29 and include it too." The site sells Starter at $14.50 (catalog.js PACKAGES, FROM_PRICE). At the sale price, a 3-shoot package ($14.50) costs less than "keep all + 2 looks" ($14.99), so the email steers people to the worse deal and contradicts the pricing page.
File: lib/mail.js:245 and :252. Fix: use `FROM_PRICE` from catalog.js (as the checkout variant already uses pkg.price), or drop the price. Reproduced: yes.

**G7-02 (medium, bug): one half-deleted account aborts the owner's offer send.**
Repro: zz-g7-offer.mjs. Create a recipient, write `cancelled/users/<uid>.json` (the state an account deletion leaves if it fails partway), then POST /api/owner/offer {send:true}. Result: 9 emails go out, then HTTP 410 "This shoot or account has been deleted." The report counts are lost and nobody after that account is emailed. Every later send stops at the same account. The dry run also counted it as eligible.
Cause: lib/outreach.js:151 `users.update` throws 410 from userWrite and isn't caught (the send's try/catch starts at :177). allUsers/offerFor never check accountDeleting.
Fix: skip accountDeleting accounts in offerRecipients, and wrap the claim in try/catch (continue on a 410). Reproduced: yes.

**G7-03 (low, bug): a restore brings back a deleted account's per-person records.**
Repro: zz-g7-restore.mjs and zz-g7-restore2.mjs. Sign up, add a shoot with a develop claim and funnel steps, back up via /api/cron/backup, delete the account via /api/account/delete (which deletes `stats/seen/*/<uid>.json`, server.js:1672), then run `restore-backup.js --apply --photos`. Restored: `stats/seen/{signup,checked,developed,buyer}/<uid>.json` and `claims/develop/<sid>.json` (which holds the userId). Everything else (user, email index, shoots, idx, photos) is correctly skipped as erased.
File: lib/photo-backup.js:301 (recordErased's regex leaves out stats/seen and claims/develop). Fix: treat `stats/seen/<step>/<uid>` and `claims/develop/<sid>` as erasable by uid/sid. Reproduced: yes.

**G7-04 (low, bug): the alert caps aren't shared across servers as the comment says.**
Repro: zz-g7-alert.mjs. Load 8 independent copies of lib/alert.js (like 8 instances) on one store; each notes an error and flushes at once. Result: 8 alert emails, against a cap of 4 an hour. flush() reads the counter, sends, and only then counts (lib/alert.js:89–108), so instances flushing together all pass the check. An outage that hits every instance is exactly when this happens, and it can use up the daily allowance that sign-up emails need.
Fix: reserve atomically first (`withCounter`, n<cap → n+1), and hand the slot back if the send fails. Reproduced: yes (in-process instances).

**G7-05 (low, bug): the nightly backup leaves out two prefixes.**
`stats/refunds/` (6 on disk, 0 in the snapshot) and `takeovers/`. After a restore, the next refund webhook for an already-refunded order counts its whole refunded amount again in the funnel (recordRefund's delta starts from 0). An unfinished takeover purge (its plan of the earlier holder's photos) is never resumed, because resumeTakeovers lists only `takeovers/`.
File: lib/backup.js:24. Fix: add "stats/refunds/" and "takeovers/" to PREFIXES. Reproduced: yes for the snapshot contents; the consequences are from code reading.

**G7-06 (low, bug): the checkout reminder's "Finish checkout" link opens the sign-up page.**
Repro: Playwright on /app/buy/professional while signed out (g7out/buylink-390.png). It redirects to /signup?next=… with "STEP 1 OF 3 / Create your account". The email goes only to people who already have an account. A "Sign in" link is lower down.
File: public/js/app.js:201 (/app/buy/ sends guests to signup). Fix: link the reminder to `/signin?next=/app/buy/<id>`, or send /app/buy/ to signin when the visitor came from an email. Reproduced: yes.

**G7-07 (low, owner decision): the privacy policy says Resend sends receipts, but the app sends none.**
public/js/views/legal.js:73 lists "receipts". lib/notify.js:21 also says "their receipt goes there too". No receipt or purchase-confirmation email exists in lib/ or server.js; any receipt would come from Stripe's own dashboard setting. Fix: add a receipt email, or change the wording to "Stripe sends receipts". Code read only.

**G7-08 (low, bug): the contact form accepts addresses that can't go in a Reply-To.**
Repro: POST /api/contact with email "eve,other@x.com" (one @, so it passes). The mail went out with `Reply-To: "…" <eve,other@x.com>`. `<`, `>`, `,` and `;` all pass the check at lib/contact.js:35, and the same pattern is used by server.js:149 and lib/teams.js isEmail. Real Resend is likely to reject such a reply_to with a 422, which would then return 502 "We couldn't send your message" for a message that was already stored.
Fix: refuse `[<>,;"()\[\]\\]` in addresses. Reproduced: yes for the header (the mock accepts it).

**G7-09 (low, cosmetic): the ready email for a single headshot says "Download them as portraits, squares for LinkedIn, or both."**
File: lib/mail.js:328. Fix: "it" when count === 1. Reproduced: yes (render).

**G7-10 (low, bug): parts of the daily clean-up have no time limit.**
Team-invite expiry (lib/cleanup.js:130), contact and rate-limit listing (:115, :121), and step 6's per-shoot getMeta loop before its deadline check don't watch the 180 s budget. After that, takeovers (30 s) and reminders (60 s) run against maxDuration 300 s. On a large store the function can be killed before the reminders run or the state saves. Code read only.

**G7-11 (low, bug): the owner's funnel window repeats or skips a day near daylight-saving changes.**
Repro: zz-g7-funnel.mjs. With now = 2026-11-02T05:30Z (11:30 pm Chicago on the 25-hour day), the rows hold 2026-11-01 twice. The same happens at 11:30 pm local on later days (e.g. Nov 9) for the rest of the 30/90-day window, so totals double-count that day and the window is one day short. At 12:30 am on 15 Mar 2027 a date is skipped. Cause: lib/stats.js:80, `day(Date.now() - i*DAY_MS)`. Fix: step through calendar dates (date arithmetic on the YYYY-MM-DD string). Reproduced: yes.

Counts: 69 items checked (39 email, 30 job). Findings: 0 high, 2 medium (G7-01, G7-02), 9 low (one of them an owner decision, G7-07).
