# A-accounts audit (prefix zz-a1, ports 3611/4611/2611), repo d1c7ac7

Method: existing suites run against a private stack (google 64/65, the one FAIL only because the test expects the CI client id "ci-client" and this stack uses "qa-client"; reset 24/24; signout 4/4; verification 9/9; takeover 11/11; verification-delivery 22/22 browser; hardening 111/111 (copied as zz-a1-hardening.mjs with the mock port fixed, run with the legacy free shoot on as CI does); demo-tests: the first 5 checks pass, then the run stalls waiting for page "load" on `/`, an environment problem (no external network) that two runs hit at different steps; the sign-out failure path it checks was reproduced by hand and works). Plus my own API scripts zz-a1-t1..t11 and Playwright scripts zz-a1-b0..b3. All scratch scripts have been deleted.

## 1. Inventory

| # | Item | How checked | Result |
|---|------|-------------|--------|
| 1 | signup: empty / short name / bad email / short pw: field errors | script t2 | OK |
| 2 | signup: name with URL / `<>` / address-like (NFKC) | script t2 | OK |
| 3 | signup: password > 200 | script t2 | OK |
| 4 | signup: email trimmed + lowercased; name trimmed | script t2 | OK (inner double spaces kept, see A1-09 note) |
| 5 | signup: non-string name | script t2 | A1-09 |
| 6 | signup: array email / tainted body | script t2 | OK |
| 7 | signup: existing address -> "already exists. Sign in instead?" | script t2 | OK |
| 8 | signup: demo address (seeded) refused as existing | script t2 | OK (seed runs at server start locally; on Vercel at first demo sign-in, and production storage persists) |
| 9 | signup: owner address -> tier none until confirmed | script t2 | OK |
| 10 | signup: Turnstile missing / failing token -> bot_check; good token -> 201; checked before the existing-address answer; field errors still come first | stack restarted with Turnstile on, script t8 | OK |
| 11 | signup UI: Turnstile script blocked -> clear message; stubbed widget -> signs up | browser b2 | OK |
| 12 | signup: per-network limit 120/h (and exempt list ignored on Vercel) | counter pre-filled, XFF, t5 | OK |
| 13 | signup: per-mailbox 3/day (+tags, Gmail dots) | script t2 | OK |
| 14 | signup: ahg_session (the session cookie), kh_device, kh_origin cookies; verification email (code in subject, link) | scripts t2/t3 | OK |
| 15 | signup UI: client validation, welcome toast (pay-first), dest for next=/join and /app/buy | browser b1, code | OK |
| 16 | signin: wrong / missing pw / empty / unknown -> same 401 text | script t2, browser b1 | OK |
| 17 | signin: email case/space-insensitive | script t2 | OK |
| 18 | signin: Google-only account with a password | script t2, browser b1 | A1-06 (owner decision) |
| 19 | signin: 10 per address per network -> 429, right pw also refused, reset lifts it | script t2, reset-tests | OK |
| 20 | signin: lock spans the previous window, but the message says 15 minutes | counter in previous window, t5 | A1-03 |
| 21 | signin: 100 total from everywhere; known device (kh_device) bypasses | t5 | OK |
| 22 | signin: per-network 60 wrong passwords | t5 | OK |
| 23 | signin: parallel guesses counted atomically | hardening-tests | OK |
| 24 | signin: demo not counted; demo seeded on demo sign-in | script t2, code | OK |
| 25 | signin while account deletion is in progress | t10 | A1-12 |
| 26 | Google start: client id, PKCE S256, state, nonce, cookie flags/path, next kept | google-tests | OK |
| 27 | Google: cancel -> ?google=cancelled (next kept) | t4, browser b1 | OK |
| 28 | Google: no/expired flow cookie, state mismatch -> ?google=expired | t4 | OK |
| 29 | Google: nonce mismatch, unverified email, bad issuer/audience/expiry -> failed | t4, google-tests | OK |
| 30 | Google: demo address refused | t4 | OK |
| 31 | Google: new account; name fallbacks (bad name -> given name -> local part -> "Keeper member") | t4 | OK |
| 32 | Google: next safe-path (/app/..., /join; //evil dropped) | t4 | OK |
| 33 | Google: new account toast on /join (team invite) | browser b3 | A1-02 |
| 34 | Google: existing confirmed account, origin browser -> linked, password kept | t4 | OK |
| 35 | Google: existing confirmed account, other browser -> password dropped, all sessions out ("google-secured") | t4 | A1-07 (owner decision) |
| 36 | Google: same sub again -> unchanged | t4 | OK |
| 37 | Google: address linked to a different sub -> failed (message) | t4 | A1-06 (message part) |
| 38 | Google: unconfirmed account, origin browser -> confirmed, password kept ("google-verified") | t4 | OK |
| 39 | Google: unconfirmed account, other browser -> takeover purge | t1, t7 | A1-01 |
| 40 | Google: invite-confirmed account | code read + t6 | OK (no purge, password dropped from another browser, by design) |
| 41 | Google: upper-case address from Google | t4 | OK |
| 42 | Google: account mid-deletion -> raw 410 JSON | t10 | A1-12 |
| 43 | Google: Google account email changed (same sub, new address) -> new separate account | code read | noted under A1-06 (owner decision, not reproduced) |
| 44 | Google reauth: signed out / password account / demo -> ?reauth=failed | t4 | OK |
| 45 | Google reauth: other Google account -> failed; cancel -> cancelled | t4, reauthcheck | OK |
| 46 | Google reauth: stale auth_time -> failed, wrong explanation shown | t4, browser b1 | A1-05 |
| 47 | Google reauth: missing auth_time asks to sign in again (reauth=stale) | google-tests | fixed 6 Nov (owner's decision; was accepted) |
| 48 | Google reauth: ok -> kh_reauth (sid-bound, 5 min, Strict, path) -> delete works; copied cookies after delete -> 401 | t4, reauthcheck 8/8 | OK |
| 49 | Google reauth then "sign out other devices" -> reauth_needed, UI re-asks | t4, code | OK |
| 50 | Google reauth return without flow cookie lands on /app with no message | t4, browser b1 | A1-04 |
| 51 | verify link: garbage / bad signature -> invalid | t3 | OK |
| 52 | verify link: expired (signed out / signed in) -> 410, correct button | crafted token, browser b1 | OK |
| 53 | verify link: origin browser -> verified; again -> already | t3 | OK |
| 54 | verify link: other browser -> ask (purges true/false) | t3, t6 | OK |
| 55 | verify link: Yes from other browser -> confirmed, opener not signed in | t3, hardening | OK |
| 56 | verify link: No -> secured, maker + opener signed out, password gone, purge | t3, browser b1 | OK |
| 57 | verify link: No racing a confirm -> already | hardening/code | OK |
| 58 | verify page UI: ask copy, confirm() dialog, secured page, "Set a password" carries email | browser b1 | OK |
| 59 | verify page: signed in as another account | hardening | OK |
| 60 | verify code: signed out -> 401; wrong/short -> 400 | t3 | OK |
| 61 | verify code: spaced code accepted; again -> already | t3 | OK |
| 62 | verify code: 8/h per account limit; 20 lifetime; mailbox 20/day | t3, code | OK |
| 63 | verify code: valid today + 3 days back, 4 days -> refused | crafted codes t9 | OK (works up to ~4 days; email says 3) |
| 64 | verify code UI (account page panel), wrong + right, panel removed | browser b1 | OK |
| 65 | resend: within 60 s of signup -> 429 "recently"; 6th in a day -> 429; signed out -> 401; confirmed -> already; ok -> sent | t3, t5 | OK |
| 66 | resend: mail disabled -> 503; provider failure -> 502 keeps reservation | verification-delivery-tests | OK |
| 67 | invite-confirmed state: no confirm panel, reminders box on, reminders never sent | t6, code | A1-08 |
| 68 | signout: revokes only this sid; copied cookie dead; other devices stay | t3, signout-tests | OK |
| 69 | signout: no session -> ok; storage failure -> 503; deleting -> ok | t3, signout-tests, t10 | OK |
| 70 | signout: 51st revoked sid within 30 days bumps sessionVersion (all devices out) | t11 | OK (documented cap) |
| 71 | signout: demo not tracked | t2, code | OK (deliberate) |
| 72 | signout-all: other devices out, this one stays; demo 403; signed out 401 | t3, t2 | OK |
| 73 | header/menu Sign out button: success + failure paths (server/offline/unconfirmed) | demo-tests, browser b0 | OK |
| 74 | forgot: bad email field error; unknown address -> same "sent"; demo -> nothing sent | t3, t2 | OK |
| 75 | forgot: 3/h per account, 60 s apart | t3 | OK |
| 76 | forgot: Turnstile required (action "reset") | t8 | OK (mock always answers action "signup", so a good token fails locally: a mock limitation) |
| 77 | forgot UI: prefill from ?email / signed-in user; "Check your inbox" copy | browser b1 | OK |
| 78 | reset email copy for an account without a password | t3 | A1-11 |
| 79 | reset/check: invalid, expired (410), used, firstPassword, per-IP 60/h | t3, t5, t9 | OK |
| 80 | reset: short / >200 / invalid / expired / reused / parallel use | t3, t9, reset-tests | OK |
| 81 | reset: confirms address; other devices out; lifts sign-in lock; marks origin after takeover | reset-tests, t3 | OK |
| 82 | reset: unconfirmed account from a browser that didn't make it -> purge | t1 | A1-01 |
| 83 | reset page UI: no token, bad token, "Choose a password" title, toast | browser b1 | OK |
| 84 | /api/me: signed in/out, no-store, flags | t2-t4 | OK |
| 85 | delete: demo 403; password wrong -> 401 field; 10/h limit (counts the right one too) | t2, t5, browser b1 | OK |
| 86 | delete: Google-only needs reauth; neither password nor Google -> "set a password first" | t4, code | OK |
| 87 | delete UI: password path, Google path, unused-shoot warning, other-tab changes redraw | browser b1, reauthcheck, acctsync 3/3 | OK |
| 88 | delete: signs out, clears reauth, other tab sent to sign-in | browser b1 | OK |
| 89 | preferences: demo 403; nothing to change; bad format; bad name; non-boolean reminders; name whitespace collapsed; refundSeen; 60/h limit | t5 | OK |
| 90 | unsubscribe: page needs click; valid -> remindersOff; bad token; no token; one-click form POST; deleted account -> 404 | browser b1, code | OK |
| 91 | lib/auth.js: cookie signature, expiry, sv, revokedSessions, timing-safe compares | code + t3/t11 | OK |
| 92 | kh_device epoch after a takeover/reset from another browser | hardening, code | OK |
| 93 | kh_origin: up to 5 accounts per browser; second account doesn't unmark the first | hardening | OK |
| 94 | purgeForTakeover: drafts removed, selfies of developed shoots dropped (or later), showcase removed, charges given back, marker | hardening, takeover-tests, t7 | OK as coded (impact: A1-01) |
| 95 | resumeTakeovers: deletes stale marker, finishes pending | hardening, code | OK |
| 96 | app.js account sync: signed out elsewhere -> /app pages to sign-in with toast; public page nav swaps | browser b1 | OK |
| 97 | app.js: different account signed in elsewhere -> /app | code read | OK |
| 98 | app.js: signed-out tab doesn't notice sign-in elsewhere | browser b1 | A1-10 |
| 99 | app.js: Google return toasts (google / -new / -verified / -secured) | browser b1/b3, t4 | A1-02 (join), A1-01 (no mention of deletion) |
| 100 | Origin check on auth POSTs | n/a | known (requests without Origin pass) |
| 101 | Reset email and wording for an account with no password and no Google (after "No" to "did you create this account?"): it sets a first password and doesn't mention Google | hardening (nightly 3 Nov) | fixed 3 Nov (was the "reset" email, "your password stays the same") |
| 102 | Google sign-up from a package's checkout page (/app/buy/<pkg>): welcome toast doesn't say "Choose a package" | browser | fixed 3 Nov |
| 103 | Auth POSTs with a cross-origin, subdomain or `Origin: null` header: 403 cross_origin | curl | OK |
| 104 | Sign-up email strictness: display-name, list and quoted forms refused; an array email refused | hardening | OK |
| 105 | Turnstile token over 2048 characters refused; widget script blocked gives a clear message | curl, browser | OK |
| 106 | Account confirmed only by a team invitation: /api/me `mailboxConfirmed:false`, confirm panel shows, resend and code work | curl, browser | OK |
| 107 | A session cookie with no sid is accepted (older cookies); auth answers are private, no-store | curl | OK (see question in rotation log) |
| 108 | Unsubscribe: one-click form POST and body-token form | curl | OK |
| 109 | Same Google account with a changed address makes a separate account | curl | known, under A1-06 |
| 110 | Sign-up and Google names: runs of spaces collapsed, as a name change does | hardening | fixed 3 Nov |

Run note: verification-delivery-tests writes `verification-delivery-shots/` into the repo root unless given an output folder as its argument; reviewers should pass one. demo-tests isn't part of ci.sh; run it on its own after changes to sign-in or the demo account.

Items checked: 110 (rotation, 3 Nov). Findings: 1 high, 0 medium, 11 low (3 of the low ones are owner decisions).

### Added at the nightly re-check of 11 Nov 2026

All 110 items above were re-checked on 11 Nov. Fixed since 3 Nov and confirmed: A1-02 (item 33), A1-03 (item 20), A1-05 (item 46), A1-09 (item 5), A1-11 (item 78); A1-08 (item 67) fixed in code. Still open (known): items 18, 25, 35, 37, 42, 50, 98. New items:

| Id | Item | How | Result (11 Nov) |
|---|---|---|---|
| N1 | Paid unconfirmed account, reset or Google sign-in from another browser keeps its draft and selfies, signs the maker out, removes the password; unpaid removes the draft | seed a purchase + draft, two browsers | OK |
| N2 | "Did you create this account?" → No still removes a paid account's maker-added drafts (owner decision, 3 Nov) | /verify "No" | OK |
| N3 | Sign-in and forgot use the loose address check; sign-up the strict one (an address with `:` signs in and resets, can't sign up) | API | OK |
| N4 | Legacy account with no emailVerified field: counts as confirmed; takes an exact-address invitation but not a Gmail variant | in-process | OK |
| N5 | Reset emails: 30 an hour per network, counting failed bot checks too | API with Turnstile on | OK |
| N6 | Confirm-code form: wrong code keeps focus in the field with the error; right code removes the panel and moves focus to the page heading, with Enter, a click or Space on the button | browser | The button click and Space left focus on the page (disabled button); fixed 11 Nov |
| N7 | Owner and demo accounts send nothing to Meta (verify link, Google, reset); a regular account sends exactly one CompleteRegistration | /mock-meta | OK |
| N8 | Account mid-deletion: forgot sends no mail, unsubscribe 404, writes 409; reminders and offers skip it. Sign-in and /api/me still succeed; Google, reset and the email link show a raw "deleted" message (A1-12, A2-02) | seed cancelled/users marker | known |
| N9 | Account names get the same cleaning as team and shoot names: invisible characters removed, a name with nothing visible refused (sign-up, name edit, Google fallback) | API | Was accepted (a blank name in invitation subjects); fixed 11 Nov |
| N10 | Google delete re-check needs Google's sign-in time within 5 minutes (missing or old → stale; another account → failed) | google-tests | OK |

## 2. Findings

### A1-01 (high) bug, or owner decision: reset or Google sign-in from a second device wipes a paying customer's own unconfirmed account
- Repro (reproduced, scripts t1/t7): sign up with a password in browser A. Buy Starter (mock pay). Create a shoot and upload 3 selfies, or fully develop one. Do NOT confirm the email: when the free shoot is off nothing asks you to (README:151, "Confirming the email no longer gates anything a paying customer needs"). Then in browser B (a phone), either (a) "Forgot password" -> reset link -> set a new password, or (b) "Continue with Google" with the same address. Result: the draft shoot is deleted (404, 0 shoots listed). A developed shoot keeps its 8 headshots but loses all its selfies, so more-looks gives 409 "This shoot's selfies were removed…" and regrade and retries can't run. Browser A is signed out. Credits stay.
- No step asks the person first, unlike the confirmation link ("Did you create this account?"). The Google toast says only "we signed you out everywhere else and removed the old password". The reset toast says "Password changed… your other devices are signed out". Neither mentions that anything was deleted.
- Impact: real customers lose their uploads and the follow-up features they paid for, just by resetting their password or using Google on their phone.
- Code: server.js:366-412 (Google: `!sameDevice && emailVerified===false` -> takenOver + purgeForTakeover), server.js:640-665 (reset: same), server.js:1530-1622; toasts at public/js/app.js:590 and public/js/views/password.js:166.
- Minimal fix: before purging on the reset and Google paths, ask the same "Did you create this account?" question as /verify, for example by sending reset/Google takeovers of an unconfirmed account to that page. Or skip the purge when the account has purchases or shoots with headshots (paid work). At least name what was removed in the toast.

### A1-02 (low) bug: Google sign-up from a team invitation says "Choose a package"
- Repro (reproduced, browser b3): admin invites x@…; x opens the /join link and chooses Continue with Google (next=/join). They land on /join, which says "Your shoot is already paid for", with the toast "Welcome, Jo. Choose a package to start your first shoot."
- Code: public/js/app.js:592-596. Email sign-up skips this case (public/js/views/auth.js:158-159).
- Fix: when the path starts with /join, show the plain welcome. Also consider /app/buy/ (auth.js says "check out" there).

### A1-03 (low) bug: "Wait 15 minutes" when the lock can last up to 30 minutes
- Repro (reproduced, t5): 10 wrong passwords from one network in the previous 15-minute window. In the current window, the right password still gets 429 "Too many attempts. Wait 15 minutes and try again…". The count spans the current and the previous window (server.js:247-256), so someone who waits 15 minutes can still be locked out.
- Fix: say "Wait up to 30 minutes", or report the actual time left.

### A1-04 (low) bug: a Google confirm-before-delete that comes back without its flow cookie drops the person on /app with no message
- Repro (reproduced, t4 + browser b1): signed-in Google-only account -> Delete -> Confirm with Google -> the kh_google cookie is lost (more than 10 minutes on Google's page, or Google opened in another browser) -> callback -> /signin?google=expired (or cancelled). /signin is guest-only, so the app redirects to /app silently: no error, and the delete form is gone.
- Code: server.js:315-318 (`back` uses `flow?.reauth`, which is null when the flow cookie is gone).
- Fix: in `back()`, when there is no flow but the request has a valid session, redirect to /app/account?reauth=failed (or show the Google error on /app).

### A1-05 (low) bug: a stale Google sign-in is reported as the wrong Google account
- Repro (reproduced, browser b1): confirming a delete with Google returns the right account but an auth_time an hour old. The page says "That didn't confirm it's you. Use the Google account you sign in to Keeper Headshots with." The account was right; Google just didn't ask the person to sign in again.
- Code: server.js:331-336 (every refusal becomes `reauth=failed`); public/js/views/account.js:30-33.
- Fix: send `reauth=stale` and say "Google didn't ask you to sign in again. Please try again (sign out of Google first if it keeps happening)."

### A1-06 (low) owner decision: unhelpful messages for Google-linked accounts
- Reproduced (t2, b1, t4): a password sign-in to a Google-only account gets "That email and password don't match an account." The person isn't told to use Google, although the account page and FAQ say a password is optional. A Google sign-in whose address is linked to a different Google account gets "Please try again, or use your email below"; trying again can't help.
- Related, from reading the code only: accounts are found by email, never by Google `sub`. If someone's Google address changes, "Continue with Google" makes a new, empty account (server.js:351).
- Code: server.js:271, server.js:364-366.
- Options: a hint under the error ("Signed up with Google? Use Continue with Google"), which doesn't reveal whether an account exists. A clearer `google=linked` message.

### A1-07 (low) owner decision: linking Google from any second browser removes the password of an already-confirmed account
- Repro (reproduced, t4 "lk3"): a confirmed account. In browser B, sign in with the correct password, then click Continue with Google. Result: "google-secured", the password is deleted, and every other session (the person's phone) is signed out, even though browser B had just proved the password and the inbox was already confirmed.
- Code: server.js:381-387.
- Option: count a browser currently signed in to this account (session sv current) as the same person, or only drop the password when it was set after the inbox was confirmed.

### A1-08 (low) bug: invite-confirmed members are shown reminders as on, but never get them and can't confirm
- Repro (reproduced, t6): admin invites m@…; m signs up with a password and joins. /api/me shows emailVerified true and emailReminders true, so the account page hides the "Confirm your email" panel and shows "Send me reminder emails" ticked. lib/reminders.js:52 and lib/outreach.js:108 skip `emailVerifiedVia === "invite"`, so none arrive. The emailed code would still work (server.js:504), but no screen offers to take it.
- Fix: expose `ownsMailbox` in publicUser (lib/auth.js:289). Show the confirm panel when the address was confirmed only by an invitation (account.js:68).

### A1-09 (low) bug: sign-up accepts a name that isn't a string
- Repro (reproduced, t2): POST /api/auth/signup {name:{a:1}, …} -> 201, account named "[object Object]". The preferences endpoint rejects the same input (nameOk checks the type).
- Minor: sign-up keeps inner double spaces ("Jo  Smith"), which a later name edit collapses.
- Code: server.js:188-189, 205.
- Fix: validate with `nameOk(name)`, and store `name.trim().replace(/\s+/g," ")`.

### A1-10 (low) bug: a signed-out tab doesn't notice a sign-in in another tab
- Repro (reproduced, browser b1): tab C is on /pricing, signed out; tab B is on /signin?next=/app/account. Sign in in tab A, then refocus C and B. C's nav still says "Sign in", and B stays on the sign-in form.
- Code: public/js/app.js:381-382 (`if (!state.user …) return`).
- Fix: when signed out, still check /api/me on focus (throttled). Swap the nav, or go to `next` from /signin and /signup.

### A1-11 (low) bug: the reset email talks about an existing password to accounts that have none
- Repro (reproduced, t3): a Google-only account presses "Email me a link to set a password". The email says "asked to reset the password… Choose a new password… If you didn't ask… your password stays the same."
- Code: lib/mail.js:132-147; server.js:610.
- Fix: pass `firstPassword: !user.password` and use "set a password" wording.

### A1-12 (low) bug: accounts mid-deletion give inconsistent answers
- Repro (reproduced, t10, with the cancelled/users marker written by hand, which is the state during a deletion or after one that failed partway). Password sign-in -> 200 and /api/me returns the user, but other calls -> 409. Google callback -> raw JSON page `410 {"error":"This shoot or account has been deleted."}`. Password reset -> 410 with the same text ("shoot or account").
- Code: server.js:390-404 (the catch passes on non-GoogleError errors), 644, 690.
- Fix: in the callback, treat `err.status===410` as back("failed"). Answer reset with "invalid". Refuse sign-in, or have /api/me report null, when `accountDeleting`.
