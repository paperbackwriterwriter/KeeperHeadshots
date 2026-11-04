# B-shoots audit (auditor b2, ports 3612/4612/2612, commit d1c7ac7)

Method: own API scripts (zz-b2-t1..t10, since deleted), existing suites run against my stack (check-gate 28/28, reshoot 29/29, api-e2e ok, retake-flow browser 15/15, render-race ok, slots-test ok, team-tests 29 PASS until its FREE=1-only section), Playwright walkthrough (zz-b2-ui), store manipulation for stuck states, mock switches MOCK_QA_FAIL=all, MOCK_FAIL_EVERY=1, MOCK_QA_TIGHT=1, MOCK_DELAY_MS, mock killed mid-check, app kill -9 mid-develop. Not run: durable-shoot-tests.js (fixed ports 4015/3217/3218).

## 1. Inventory

| Item | How checked | Result |
|---|---|---|
| GET /api/shoots anon 401 | script | OK |
| GET /api/shoots limit validation (0,49,abc,1.5,-1) | script | OK (400) |
| GET /api/shoots cursor paging, bad cursor, other user's cursor, array cursor | script | OK |
| GET /api/shoots excludes deleted shoots | script | OK |
| GET /api/shoots joinedTeam backfill | code read | OK |
| GET /api/shoots/:id bad id / other user 404 | script | OK |
| GET /:id live shoot advances (no jobId upgrade, review w/o worker) | script (store edit) | OK |
| jobId never exposed in responses | script | OK |
| dropSelfies hidden via shown() | code read | OK |
| POST /api/shoots tier none -> 402 choose package | script | OK |
| POST /api/shoots unverified + paid allowed | script | OK |
| POST /api/shoots demo 403 | code read (demo signin route n/a locally) | OK |
| POST /api/shoots name sanitise/trim 60 | script | OK |
| POST/PATCH name given as object | script | B2-5 |
| MAX_DRAFTS 20 -> 409 | script | OK |
| Default name "Shoot No. NN" | script | OK (counts all shoots incl. deleted gaps; cosmetic) |
| POST selfies: missing / gif MIME / gif, svg, tiff bytes | script | OK (400) |
| POST selfies garbage bytes | script | OK (400 readable) |
| POST selfies truncated JPEG | script | B2-1 |
| POST selfies <256px | script | OK |
| POST selfies 59 MP PNG bomb (187 KB) accepted fast; 64 MP refused | script | OK |
| POST selfies forged 30000x30000 JPEG header | script | OK (400) |
| POST selfies HEIC/AVIF | script | AVIF labelled jpeg accepted and converted (harmless); HEIC (HEVC) not decodable by sharp -> 400; browser converts on Safari, clear message elsewhere (code read) |
| POST selfies WebP, EXIF rotation | script | OK |
| POST selfies 8 parallel -> capped at 6, no orphan media | script | OK |
| POST selfies after develop 400; upload rate limit 150/h | script / code read | OK |
| POST selfies resets check to draft | script | OK |
| DELETE selfie: unknown 404, ../ 404, other user 404, last photo 400, after develop 400, check re-indexed | script | OK |
| /check no selfies 400, parallel double check one 409 | script | OK |
| /check sample / developed 409 | script | OK |
| /check tier none (started) 402 | script | OK |
| /check paid: checkDay counted once; daily cap 40 -> 429 and status restored | script | OK |
| /check retake refund (paid & free mailbox), refunded flag, override recount | script + check-gate-tests | OK |
| /check free allowance, per mailbox, extra-before-shoot daily, free shoot used | check-gate-tests (FREE=1) | OK |
| /check AI failure -> error banner, status restored, counts refunded | script (mock killed) | OK |
| /check on shoot stuck in "checking" | script | B2-7 |
| /check deleted mid-run | script | OK server-side (response {shoot:null}; only reachable from another tab) |
| /check reshoot free checks (3) / team seat not spending free checks | reshoot-tests, team-tests | OK |
| /generate no check, blocks <65 even with override, 65-75 needs override | script | OK |
| /generate looks: none, non-array, invalid ids, nulls, 5 looks, dupes deduped | script | OK |
| /generate charges 1 credit, paidWith/paidBy, u.developing cleared, developed flag | script | OK |
| /generate x3 parallel -> one charge | script | OK |
| /generate no credits 402, claim removed, works after buying | script | OK |
| /generate again 409 | script | OK |
| /generate team looks forced, team unpaid 402 | team-tests + code read | OK |
| /generate reshoot: original looks forced, no charge, reshoot_used marking | reshoot-tests + script | OK |
| /generate free shoot (legacy): looks<=2, free_used | check-gate/reshoot-tests (FREE=1) + code read | OK |
| Stale develop claim takeover | code read | known (ms race listed) |
| /more-looks: none 400, existing look 400, > have 400, >4 looks 400, parallel one wins, credit consumed, regrade after | script | OK |
| /more-looks no selfies 409 | code read | OK |
| /resume: live 409, nothing 400, 3 retries then 429 resume_limit | script | OK |
| /resume within 15 s of last on an error shoot | script | B2-4 |
| /resume refunded package 402 / no selfies 409 | reshoot-tests + code read | OK |
| /reshoot: nothing held 400, held for likeness (QA_FAIL=all) 201, same returned again, reshoot of reshoot 400, used 409, refunded 402, original deleted -> ordinary shoot | script + reshoot-tests | OK |
| /review: generating refused, 202, double click counted once, keeps own pick, 3rd -> 429 | script | OK |
| PATCH: empty name 400, rename, bad pick 400, pick sets cover, clear pick restores AI best, other user 404 | script | OK |
| DELETE at draft, checking, checked, generating, reviewing, done, error | script | OK (no media/shots/jobs/meta left, slots released) |
| DELETE releases extraLooks, kept, reshoot link, team seat | script + reshoot/team tests | OK |
| POST /api/internal/shoot-worker: empty, bad sig, expired, non-ASCII sig 404; signed 202 | curl | OK |
| GET /api/cron/shoots: no/wrong secret 404, ok 200 report | curl | OK |
| pipeline QA retakes (3 attempts) & all held back -> QA_ALL_FAILED | script MOCK_QA_FAIL=all | OK |
| pipeline render outage (FAIL_EVERY=1) | script | B2-3 (also known: outage uses retries) |
| square widening (QA_TIGHT) 1:1 <=1024, removed with shoot | script | OK |
| render slots site-wide queueing ("next in line") | slots-test, render-race | OK |
| stale check / stale render lease / stale review recovery | script (store edits) | OK |
| durable job after app crash, no browser | script (kill -9) | OK, see B2-6 |
| selfies purge on finish (dropSelfies) | code read | OK |
| shoot-list catalog (deleted entries filtered) | script | OK |
| Client: new shoot upload, thumbs, auto check, looks fill, tally, develop progress, proofs, viewer, downloads, pick, dashboard card, delete | Playwright (390px) | OK, no page errors |
| Client: wide photo (panorama) upload | Playwright | B2-2 |
| Client: retake flow, continue anyway, replace marked photos | retake-flow-tests | OK |
| Client: reshoot banner / tips dialog | code read + reshoot data | OK |
| Client: viewer/filters/download-format/focus issues | - | known (listed in brief) |
| dashboard.js plan banners / shoots list | Playwright + code read | OK |
| Team reshoot (B-N1): made, same one returned when asked again, develops in the team's looks, nothing charged to member or admin | reshoot-tests | OK (4 Nov) |
| Team member's free retry on a failed team shoot (B-N2) | script | OK |
| Team reshoot photo checks (B-N3): 3 free, then 402 with a reshoot message | reshoot-tests | fixed 4 Nov (said "start your first shoot") |
| Team reshoot after the admin's package was fully refunded (B-N4): 402 | reshoot-tests | OK |
| Admin's team page shows and downloads the reshoot's pick; a stranger gets 404 (B-N5) | reshoot-tests | OK |
| Member deletes the failed original after the team reshoot is done (B-N6): admin keeps the headshot | reshoot-tests | fixed 4 Nov (owner's decision: the reshoot takes over the seat) |
| Member deletes the original before the team reshoot develops (B-N7): the reshoot becomes the team seat and develops free | reshoot-tests | fixed 4 Nov (owner's decision) |
| Studio for a failed team shoot: reshoot banner, tips dialog, free retry; team reshoot draft and dashboard at 390px (B-N8) | Playwright | OK |
| Fixed audit bugs kept as checks (B-N9): truncated JPEG 400; too-narrow photo named; outage gives a whole-shoot message; quick retry 429 retry_soon; non-text name | hardening, Playwright | OK |
| /check during an AI outage: 502, status restored, checkDay given back (B-N10) | script (mock stopped) | OK |
| Delete during a running check: {shoot:null}, nothing written back (B-N11) | script | OK |
| Stale render lease becomes a "Rendering timed out" frame and the shoot settles (B-N12) | durable suite | OK |
| Square widening can attach after "done" and the ready email (B-N13) | script | OK (owner question) |
| App killed mid-develop with no browser open: finishes in about 6 min with timed-out frames (B-N14) | script | known (B2-6) |
| durable-shoot-tests (needs FREE_SHOOT_OFFERED=1) and dashboard-history-tests (bind port 0) via port-shifted copies (B-N15/16) | suites | OK |
| render-race and slots-test on two servers sharing one store (B-N17) | suites | OK |
| AVIF bytes sent as JPEG accepted and stored as JPEG (B-N18) | script | OK |
| Adding extra looks resets the shoot's free retries (B-N19) | code read | decision: kept (4 Nov) |
| A headshot shared from a free reshoot comes down on a full refund of the original's package (own and team) | reshoot-tests | fixed 4 Nov (it stayed) |

Items checked on 4 Nov (rotation): 93 (74 + 19 new).

## 2. Findings

**B2-1** low, bug. Truncated/corrupt JPEG whose header parses returns 500 "Something went wrong" and logs a stack (prod error alert email). Repro: POST /api/shoots/:id/selfies with the first third of a valid JPEG as data:image/jpeg. Server log: "VipsJpeg: premature end of JPEG image at ingestSelfie (lib/pipeline.js:51)". Fix: wrap the decode at lib/pipeline.js:51 in try/catch and throw AIError("That file isn't a readable image.", {status:400}). Reproduced: yes.

**B2-2** low, bug. Browser checks the 256px minimum before downscaling to 1600px long side (public/js/views/studio.js toJpegDataURL ~1366-1378). A wide photo (e.g. 3000x400) is accepted as a thumb, sent as 1600x213, server refuses "too small", and the whole upload is aborted and the new shoot deleted; the toast doesn't say which photo. Repro: Playwright, upload a normal selfie + 3000x400 JPEG, click Check my photos -> stays on /app/new, toast "That photo is too small", 0 shoots. Fix: check min side after scaling (or scale so the short side stays >=256), and name the file. Reproduced: yes.

**B2-3** low, bug (copy). When every frame fails for a non-QA reason (render outage), the shoot-level error is the frame message "This frame couldn't be developed. Retry it in a moment.", shown as the develop page subtitle. Repro: MOCK_FAIL_EVERY=1, develop -> shoot.error as above. lib/pipeline.js:434-435 only rewrites QA_FAILED. Fix: map any frame error to a whole-shoot message ("None of the headshots could be developed. Retry them; retries are free."). Reproduced: yes.

**B2-4** low, bug. /resume on a shoot that is already back in "error" within 15 s of the previous resume returns 409 "This shoot is still in progress." (server.js:1215 resumeStartedAt guard). Happens when frames fail fast (outage, QA fails quickly). Repro: QA_FAIL=all, resume, wait for error (<15 s with fast mock), resume again -> 409. Fix: apply the 15 s guard only while LIVE, or say "A retry just started; try again in a few seconds." Reproduced: yes.

**B2-5** low, bug. POST /api/shoots {name:{a:1}} creates a shoot named "[object Object]"; PATCH same (server.js:780, 1335). Fix: accept name only when typeof === "string". Reproduced: yes.

**B2-6** low, owner decision. After an instance dies mid-render, its in-flight frames sit "rendering" until the 6-min lease expires, then become "Rendering timed out — retry this frame." errors; the shoot completed ~6 min later with 2 failed frames that need a manual (free) retry. Repro: kill -9 app 3 s after develop, restart, no browser -> done in 375 s, 2 timed-out frames. lib/pipeline.js:353-370 (LEASE_MS). Option: put timed-out frames back to pending once (automatic retry) instead of error. Reproduced: yes.

**B2-7** low, bug. POST /check on a shoot stuck in "checking" past the lease is refused 409 "A photo check is already running" by the route's early status check (server.js:879), so beginCheck's staleRun takeover (lib/pipeline.js:75) is dead code; recovery only happens through a GET poll (advance). Repro: set status checking with checkStartedAt 10 min old, POST /check -> 409. Fix: drop the early 409 or let it through when stale. Reproduced: yes (low impact: the studio page polls GET and recovers).

Counts: ~95 inventory items checked; findings: 0 high, 0 medium, 7 low (6 bug, 1 owner decision).
