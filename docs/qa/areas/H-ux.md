# H-ux audit: signed-in app screens (auditor zz-h8)

Stack: ports 3618/4618/2618, FREE_SHOOT_OFFERED=0, OWNER_EMAILS=owner-qa@example.com (confirmed: owner-qa account reports plan.tier "owner"). The stack died once partway through; I restarted it and rebuilt every account and state. Accounts I created: fresh (verified, nothing bought), unverified, paid (Executive, with shoots in every status), out of shoots, returning with no shoots, team admin, team member, demo, owner. I made the generating, reviewing, error and reshoot-eligible states by editing the store copies of real developed shoots. I made a legacy locked preview by setting `preview:true` on a member shoot.

Method:
- Sweep (448 page loads): every route and state at 320, 390 and 1280 px, light and dark, plus 200% text at 390 and 1280. Each load ran axe-core 4.x (wcag2a/aa, 21aa, 22aa, best-practice) with bypassCSP, an overflow and off-screen check, and logs of console errors, failed requests and 4xx/5xx responses.
- States sweep: axe and overflow on interactive states (viewer, share form, looks editor, retake panel, name edit, delete form, team settings, nav sheet, search dialog, toasts, upload thumbs, auth errors, forgot-password sent, checkout return, owner offer count) at 320, 390 and 1280, light and dark.
- Keyboard-only scripts: focus after every action.
- Two-tab, offline, slow-network (route delays), double-submit and back/forward/reload scripts.

## 1. Inventory

| # | Item | How checked | Result |
|---|------|-------------|--------|
| 1 | Dashboard, new customer (fresh): "Choose a package to start your first shoot" | sweep 6 combos + 200% | OK |
| 2 | Dashboard, returning customer with no shoots and no credits ("next shoot") | sweep | OK |
| 3 | Dashboard, out of shoots (banner "You're out of shoots") with a done shoot | sweep | OK; upsell contrast H8-02 |
| 4 | Dashboard, team member (team banner, member shoot card) | sweep | OK |
| 5 | Dashboard, demo (demo banner, sample cards) | sweep | OK |
| 6 | Dashboard, paid user with cards in every status (draft, checked/ready, retake recommended, retake needed, generating, reviewing, done, error) | sweep | OK (badges and names announced; axe clean) |
| 7 | Dashboard, unverified account (free shoot off: no code box on dashboard) | sweep | OK |
| 8 | Dashboard "Show more shoots" (more than 24 shoots) | keyboard | H8-01 (button hides, focus to body) |
| 9 | Dashboard 15 s/60 s refresh and focus-triggered sync | two-tab | OK (deleted shoot disappears after focus) |
| 10 | Dashboard checkout return: success, cancelled, bogus session, success URL reopened | states + two-tab | OK |
| 11 | New shoot, can't start (no package): "Choose a package first" | sweep + two-tab | OK; switches to upload when a package is bought in another tab |
| 12 | New shoot upload: thumbs, remove, count, Check my photos | sweep, states, keyboard | Remove thumb: focus to body (H8-01) |
| 13 | Upload double-click "Check my photos" | script | OK (one shoot) |
| 14 | Upload: Back mid-upload | script | OK (half-made shoot deleted) |
| 15 | Upload: Reload mid-upload | script | Leaves a draft with 1 photo (H8-10, owner decision) |
| 16 | Upload with draft limit (20 undeveloped) | API | OK (clear 409 message) |
| 17 | Free reshoot upload (/app/new?reshoot=) | sweep | OK |
| 18 | Photo check, draft with no photos | sweep | OK |
| 19 | Photo check, draft with photos (Run photo check) | sweep | OK |
| 20 | Checking state (phrases, aria-live) | read code + develop script | OK |
| 21 | Check result: ready | sweep + keyboard | OK |
| 22 | Check result: retake recommended (70) with "Continue anyway" | sweep | OK |
| 23 | Check result: retake needed (62, blocked) | sweep + states | OK |
| 24 | Add photos and auto re-check; Re-check photos | keyboard | OK (focus to the h1) |
| 25 | Looks picker: select, add, remove, backdrop and outfit, back | keyboard + states axe | OK except "Fill remaining slots" (H8-01) |
| 26 | Looks picker: Fill remaining slots | keyboard | H8-01 |
| 27 | Team looks and reshoot looks (set looks) | read code; member shoot developed through the API | OK |
| 28 | Develop button, double-click | script | OK (1 generate request) |
| 29 | Develop progress page (generating, queued, reviewing) | sweep | OK; focus after pressing Develop lost (H8-01) |
| 30 | Develop to proofs auto-transition | keyboard | OK (focus to the h1) |
| 31 | Stopped/error shoot, "Retry N failed frames" | sweep + keyboard | Retry: focus to body (H8-01) |
| 32 | Selfie-tips dialog (2+ frames held for likeness) | sweep + keyboard | Escape closes it; focus to body (H8-06) |
| 33 | Reshoot banner | sweep | OK |
| 34 | Results: hero, scoreboard, bars, best-for | sweep | OK |
| 35 | Results: viewer open, Escape, arrows, pick in viewer | keyboard + states | Escape OK, focus returns; eyebrow contrast H8-03; arrow-key/Retakes filter issues are known |
| 36 | Results: filters | keyboard | OK (known: viewer ignores the Retakes filter) |
| 37 | Results: make my pick (grid/viewer), use retoucher's pick | keyboard | OK |
| 38 | Results: download format picker portrait/square/both | keyboard + slow route | Race H8-08; other-tab change is known |
| 39 | Results: Download best / All N / profile kit / viewer portrait+square links | read code + sweep | OK (guarded HEAD; known items not repeated) |
| 40 | Results: share panel open/cancel/submit/take down | keyboard + states axe | Submit: focus to body (H8-01); take-down is known |
| 41 | Results: upsell for paid, none, team-paid, demo/sample | sweep | Popular card's was-price unreadable (H8-02) |
| 42 | Results: Re-grade / Retry grading | keyboard | Focus to body (H8-01) |
| 43 | Results: Delete shoot | read code; confirm() then navigate | OK |
| 44 | Results: legacy locked preview (keep CTA $8.99, keep-all $14.99, viewer keep button) | store edit + browser | OK (flows to checkout and back) |
| 45 | Results on a shoot deleted in another tab (pick) | two-tab | OK ("We couldn't find that shoot") |
| 46 | Shoot not found (/app/shoot/bogus) | sweep | OK |
| 47 | Shoot page offline first load ("Couldn't load", Try again) | offline | H8-05 when the view module isn't cached yet |
| 48 | Buy page embedded checkout | sweep (js.stripe.com unreachable here) | Falls back to hosted as designed; OK |
| 49 | Buy page hosted fallback, Back from Stripe | script | OK (replace(); Back lands on /app) |
| 50 | Buy page: bad package, keep without shoot, demo, signed-out redirect to signup | sweep | OK |
| 51 | Buy success / cancel (dashboard, shoot, team) | states | OK |
| 52 | Account page: all panels, demo variant, owner links | sweep | OK |
| 53 | Account: edit name (Escape, save), two-tab rename | keyboard + two-tab | OK |
| 54 | Account: download format radios | sweep + read code | OK |
| 55 | Account: reminders toggle | keyboard | Focus to body (H8-01) |
| 56 | Account: sign out other devices | keyboard | Focus to body (H8-01) |
| 57 | Account: delete form (password, wrong password, cancel, Escape) | keyboard + states | Escape doesn't close it (H8-09) |
| 58 | Team admin: setup (fresh, unverified-locked), settings, add/remove look, save, cancel | sweep + keyboard | Focus to body on Change/remove/cancel/save (H8-04) |
| 59 | Team admin: invite, resend, copy, cancel, buy link (return=team) | keyboard + double-click | Invite/resend/cancel: focus to body (H8-04); double-click OK |
| 60 | Team admin 30 s refresh | keyboard (31 s wait) | Repaints every 30 s even with no change, throwing focus to body (H8-04) |
| 61 | Join page: no token, guest with token, wrong email, accept, used | sweep + setup | OK |
| 62 | Owner /app/funnel (owner), non-owner redirect | sweep | Tables not keyboard-scrollable (H8-07) |
| 63 | Owner funnel: period switch, count, send offer | keyboard | Count: focus to body (H8-01) |
| 64 | Owner /app/showcase review approve/stop/delete | keyboard | Approve: focus to body (H8-04) |
| 65 | Sign in / sign up (errors, demo button, Google button) | sweep + states | OK |
| 66 | Verify page: no token, link confirm, ask (another browser) | sweep + keyboard | After Confirm: focus to body (H8-06) |
| 67 | Forgot / reset (no token, sent) | sweep + states | OK |
| 68 | Toasts: light/dark contrast, keyboard dismiss | states + keyboard | OK |
| 69 | Search dialog (marketing chrome, signed in): open, type, arrows, Enter, Escape | keyboard + states axe | OK (focus returns to the button; dialog scrolls at 320) |
| 70 | Mobile menu (app chrome): open, Escape, tab past end | keyboard | Escape and tab-out OK; focus stays on the toggle on open (known) |
| 71 | 404 page (guest/signed in) | sweep | OK |
| 72 | 200% text on every screen | sweep + preset-font probe | No layout breaks at load; header doesn't collapse when text size changes on short pages (H8-11) |
| 73 | 320/390/1280 horizontal overflow, all screens and states | sweep + states | OK (no overflow at 100%) |
| 74 | Console errors / failed requests on every screen | sweep | OK (only the expected 404s and the blocked stripe.js) |
| 75 | Two tabs: buy | script | OK (tab A updates on focus) |
| 76 | Two tabs: delete | script | OK |
| 77 | Two tabs: rename | script | OK (chip and greeting update) |
| 78 | Two tabs: sign out | script | OK (tab A goes to sign-in with a toast) |
| 79 | Two tabs: change format | n/a | known |
| 80 | Double submit: name save, invites, develop, sign-up | script/read | OK |
| 81 | Offline: pick, reminders, sign-out toasts | script | OK messages |
| 82 | Offline: in-app navigation to a not-yet-loaded view | script | H8-05 |
| 83 | Slow network: first load with slow /api/me | route delay 4 s | Blank page, no indicator (H8-12) |
| 84 | Slow network: dashboard/shoot skeletons, buy spinner | route delay | OK |
| 85 | Back/forward on looks sub-view; reload on looks | script | Picks lost; Back leaves the shoot (H8-10, owner decision) |

## 2. Findings

**H8-01 (medium, bug): `busy()` and repaints drop keyboard focus to `<body>` after in-place actions.**
- Cause: `busy()` (public/js/core.js:249) disables the focused button. Chrome then blurs it, and `restore()` never refocuses it. Several studio repaints also skip `restoreFocus`.
- Reproduced (Playwright, keyboard only; `document.activeElement` is BODY after each):
  - Account: "Sign out of other devices", reminders checkbox (account.js:249 disables it).
  - Funnel: "Count recipients".
  - Team: "Resend".
  - Dashboard: "Show more shoots" on the last page (the button hides).
  - Studio: Develop (studio.js:784 and 612, `paintDevelop` at 895 has no focus handling), "Retry N failed frames" (1308), Re-grade (1294), "Fill remaining slots" (709 hides the focused button; `restoreFocus` at 172 returns after focusing a hidden element instead of falling back).
  - Upload: removing a thumb (`draw()`, 1473).
  - Share: "Send for review" (share.js:106).
- Impact: keyboard and screen-reader users must tab from the top of the page after each of these actions.
- Fix:
  - In `busy()`, remember whether `btn` had focus and refocus it in `restore()`. Or use `aria-disabled` with a click guard instead of `disabled`.
  - Call `restoreFocus(null)` at the end of `paintDevelop`.
  - In `restoreFocus`, fall back to the h1 when `el` isn't focusable (`el.offsetParent === null` or `el.hidden`).
  - After "Show more" hides, focus the first newly added card.

**H8-02 (medium, bug): the crossed-out list price on the popular package card in the results upsell is unreadable.**
- Contrast is 1.3:1 in light mode (#565766 on #7a2e2e) and 2.84:1 in dark mode.
- Reproduced with axe on every results page that shows packages: out-of-shoots, team member, locked preview.
- Impact: the "was $39" half of the advertised 50%-off is invisible on the highlighted card.
- File: public/css (`.price-was` at line 554 uses `--text-muted`). `.upsell-pkg.pop` (line 1127) has no override; `.plan-pop` and `.tm-price-pop` do (lines 561 and 564).
- Fix: `.upsell-pkg.pop .price-was { color: inherit; }` (or `--text-inverse-muted`).

**H8-03 (low, bug): the viewer's "Frame NN · n of N" eyebrow is 2.36:1 in light mode** (#525c6c on the #14213d dark viewer).
- Reproduced with axe at 320, 390 and 1280.
- Fix: `.lightbox .eyebrow { color: var(--text-inverse-muted); }`.

**H8-04 (medium, bug): the team admin and owner review pages rebuild the whole page after every action, and the team page also does it every 30 s.**
- Team page: Change, remove look, cancel settings, save, send invites and cancel invite all repaint with `root.innerHTML` (teamadmin.js:122, 195, 237). Focus goes to body each time.
- The 30 s timer (teamadmin.js:253–257) repaints even when nothing changed. It's skipped only while #emails is focused, so a keyboard or screen-reader user resting on "Copy link" is thrown to the top every 30 s. Reproduced with a 31 s wait.
- Owner showcase: Approve, Stop showing and Delete re-render the list via `load()` (showcaseadmin.js:58). Focus goes to body.
- Fix:
  - Repaint on the timer only when the team data's signature changed.
  - After a repaint, restore focus by data-attribute (as studio's `focusedId`/`restoreFocus` does) or move it to the section heading.

**H8-05 (low-medium, bug): one offline moment breaks a page until full reload.**
- Repro: open /privacy (so /app/account's module isn't loaded), go offline, navigate in-app to /app/account, go back online, navigate there again.
- The page shows "This page failed to load. Failed to fetch dynamically imported module: http://localhost:3618/v/…/views/account.js" both times. Chrome caches the failed dynamic import, so it keeps failing until a reload. Same for the shoot page.
- File: app.js:4 (`lazy`), app.js:237.
- Fix:
  - Clear the cached promise and retry `import()` with a cache-busting query on failure.
  - Show a plain message ("You appear to be offline…") instead of the raw module URL.
- Reproduced: yes.

**H8-06 (low, bug): focus is lost when a full-page message replaces the content.**
- Verify page: after "Confirm my email" the result screen replaces the card and focus goes to body (verify.js:102 `done()` doesn't focus the h1; `ask()` does).
- The selfie-tips dialog opens on page load. On Escape or "Not now" it is removed (studio.js:852) and focus falls to body.
- Fix: focus the new h1 in `done()` and `secured()`; on the dialog's close, focus `main h1`.
- Reproduced: yes.

**H8-07 (medium, bug): the owner funnel's two scrollable tables can't be reached by keyboard.**
- axe `scrollable-region-focusable`, serious, at all 6 width/scheme combinations.
- At 320/390 the columns past the screen edge can't be scrolled into view without a pointer.
- File: funnel.js:87, 128.
- Fix: `tabindex="0" role="region" aria-label="…"` on `.funnel-table-wrap`.

**H8-08 (low, bug): download-format race on a slow network.**
- Repro: on results, click Square, then Both within ~100 ms, with the first preferences request delayed 2.5 s.
- End state: the Both button shows pressed, "Download best pick · 1:1" (square), and the server saved square.
- File: format.js:22 (`state.user = data.user` from a stale response).
- Fix: sequence the saves (ignore responses older than the latest request, or queue them).
- Reproduced: yes.

**H8-09 (low, bug): Escape doesn't close the account delete form**, though it closes the name editor (account.js:203).
- Reproduced: yes.
- Fix: add a keydown Escape handler on `#deleteForm` that runs the Cancel logic.

**H8-10 (low, owner decision): mid-flow navigation loses work.**
- Reload during upload leaves a draft shoot with only the photos that uploaded so far. Reproduced: draft with 1 photo.
- The looks picker is not a history entry: Back from it leaves the shoot (to the previous page), and reload returns to the photo check. Chosen looks are lost either way.
- Possible fix: push a history entry (or `?step=looks`) for the looks view and keep picks in sessionStorage. Add a `beforeunload` prompt while uploading.

**H8-11 (low, bug): changing text size while on a short page doesn't collapse the header.**
- On short pages (join with no token, 404, buy errors, owner showcase, shoot not found), changing text size to 200% leaves the header uncollapsed. The nav actions run 35–343 px off-screen at 1280 px, and nothing collapses until the next navigation.
- Cause: the ResizeObserver watches `<html>`, whose size doesn't change while `.app-main` holds `min-height: calc(100dvh - 72px)`.
- Text already at 200% when the page loads is handled correctly (verified).
- File: app.js:295.
- Fix: also observe `.nav-inner` (or `#nav`) itself.

**H8-12 (low, bug): a slow first load shows a blank page.**
- With /api/* delayed 4 s, `#app` is empty for the whole wait (no skeleton, no `aria-busy`) on /app and other signed-in pages. `render()` waits for `loadSession()` (app.js, end of file).
- Fix: show the app shell or a spinner before `/api/me` resolves.
- Reproduced: yes.

Known items met (not re-reported): mobile menu focus on open; Retakes filter in the viewer; format change in another tab; take-down focus; admin download saves two files.

Note: the working tree has uncommitted changes in lib/*.js, public/js/app.js and public/js/views/account.js that I did not make. My line numbers are from the working tree as it was during the audit.
