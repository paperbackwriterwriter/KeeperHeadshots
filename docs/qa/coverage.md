# QA coverage map

The checklist the nightly QA run works from. It came out of a full audit on
3 November 2026 that checked every route, page state, email, scheduled job
and promise in the site's copy, in eight areas. Each area's file lists every
item, how it was checked, and the result on that day.

| Area | File | What it covers |
|---|---|---|
| A | [areas/A-accounts.md](areas/A-accounts.md) | Sign-up, sign-in, email confirmation (link, code, "did you create this account?"), password reset, Google sign-in/linking/re-check, sessions and sign-out, account page and deletion, takeover purge, unsubscribe, rate limits, demo account |
| B | [areas/B-shoots.md](areas/B-shoots.md) | Shoots: create, upload (formats, sizes, corrupt files), photo check, looks, develop and charging, rendering, retries, reshoot, extra looks, regrade, delete at every status, durable jobs and recovery, studio and dashboard screens |
| C | [areas/C-payments.md](areas/C-payments.md) | Checkout (packages at the sale price, legacy preview offers, promo codes), confirm/sync/webhook, refunds to the cent, disputes, credits and debt, owner/demo accounts, funnel revenue, Meta purchase values, buy page |
| D | [areas/D-teams.md](areas/D-teams.md) | Team set-up, invitations (send, resend, link, cancel, lapse), joining, seats and refunds, admin view, members on two teams, deleting accounts, team pages and banners |
| E | [areas/E-security.md](areas/E-security.md) | All 83 routes: who may call each, input checks, rate limits, Origin/CSRF, error handling, caching; media and watermarks, owner/admin/cron/worker access, headers and CSP, cookies, redirects, injection, SSRF, storage paths, denial-of-service inputs |
| F | [areas/F-public.md](areas/F-public.md) | Every public page: claims in the copy against the code, contradictions between pages, JSON-LD, meta tags, sitemap dates, prerendered HTML, links, contact form, search, blog, social images, llms.txt |
| G | [areas/G-emails-jobs.md](areas/G-emails-jobs.md) | Every email (who gets it, wording, links, escaping) and every scheduled job (clean-up, reminders, backup and restore, blog sync, shoot worker), owner offers, alerts, funnel stats |
| H | [areas/H-ux.md](areas/H-ux.md) | Every signed-in screen at 320/390/1280, light and dark, 200% text: keyboard and focus, screen-reader names (axe), two tabs, double-submit, back/forward/reload, slow and offline networks |

## Nightly rotation

Each night re-checks one area in full (A, B, … H, then A again), using that
area's file as the checklist: every item gets a fresh result, and anything new
in that area is added as a new item. The run appends a line to
[rotation-log.md](rotation-log.md).

## How to test

- `bash scripts/dev/ci.sh`: every server test suite (fixed ports 3100, 3101,
  4010, 2525; about 15 minutes).
- `bash scripts/dev/layout-ci.sh chromium <out-dir>`: the layout audit (same
  ports, so never at the same time as ci.sh).
- `bash scripts/dev/qa-stack.sh <app> <mock> <smtp> [1]`: an app server and the
  stand-in services on ports of your choosing (reviewers use 36xx/46xx/26xx),
  with a fresh data folder; `1` turns the legacy free shoot on, and
  `QAFAIL=all` in front makes every AI quality check fail. The stand-in
  (scripts/dev/mock-ai.js) also serves sent mail at `/mock-mail`, payments at
  `/mock-pay/<checkout id>` (`?promo=FREE` or `?promo=HALF`) and refunds at
  `/mock-refund/<checkout id>?amount=<cents>`. A Google sign-in is completed
  by calling `/api/auth/google/callback` with a code that is base64url JSON of
  the claims (see scripts/dev/google-tests.js).
- Several suites assume the legacy free shoot is on (ci.sh turns it on); run
  against a stack without it, they stop early. That is a test assumption, not
  a product bug.

## Decisions (not bugs)

- Legacy free previews are watermarked until bought; the "Download this photo" (keep) button replaces
  the download buttons on them; cancelling that checkout from the viewer
  leaves that frame as the pick.
- Google sign-in links to an existing account with the same email.
- The Google re-check before deleting a Google-only account asks the person to
  tick the box again afterwards.
- DMARC is p=reject. The demo account is public and read-only. Example images
  under /examples/ 404 locally. The desktop nav has no Contact link.
- Requests without an Origin header pass the Origin check (Stripe, cron, mail
  apps). The Vercel queue route trusts its ce-type header (jobs are leased).
  `appOrigin` uses the Host header outside Vercel production.

## Known open items (not to be re-reported as new)

Decided by the owner on 3 Nov and done (A1-01, F2, D-02 looks, D-05, D-09,
team download wording, F5, the sign-in email check, a per-network reset
limit, the Terms' own date): an unconfirmed account that has paid real money
keeps its work on a reset or Google sign-in from another browser; preview
offers are $4.50 / $7.50 in the sale; the admin is warned about look changes
and told what a refund did; team shoots get the free reshoot; the home page's
CDN copy is at most 10 minutes old.

Decided by the owner on 4 Nov: deleting a team shoot whose free reshoot is
still there moves the team seat to the reshoot (B-R1, B-N7: done; the seat
counts as spent, so it's never given back); a team reshoot keeps 3 free photo
checks; extra looks keep resetting free retries (B-N19).

Decided by the owner on 6 Nov and done: owner and demo purchases aren't sent
to Meta (C-91); the preview-offer buttons show the crossed-out full price;
the Terms and privacy policy name Keeper Headshots LLC (F11); "Your shoots"
in the footer only for signed-in visitors; Google delete re-check needs
Google's sign-in time (A-47); a team name change warns like a look change and
the team page says "New joiners get …" when looks differ (rest of D-02);
invitations match the same inbox written differently, for an account that
confirmed its address, and the 100 cap counts only invited and joined (D-08).

Decided by the owner on 6 Nov (later) and done: owner and demo sign-ups send
no CompleteRegistration to Meta (server and Pixel); a withdrawn invitation
whose address was invited again (or joined) is hidden from the team page; the
join page says "confirm your address first" (or, for an old account, "ask for
an invitation to this address") instead of a Start button that fails; an
account from before confirmation existed has to confirm before taking a
differently spelled invitation; the invitation caps are checked inside the
same save, so two at once can't pass 100. Left as is: going back to the look
people joined with still shows the "they keep the look" warning.

Decided by the owner on 7 Nov and done: the contact form refuses a network
over its limit before the bot check (E-N11; a send still counts only once the
message can go); shoot names drop right-to-left overrides and other invisible
formatting characters (emoji joiners kept); a refund-withdrawn invitation
stays hidden once the same inbox, however spelled, was invited again,
whatever became of that invitation. Stripe items stay in the nightly "For
you" list until done.

Waiting on the owner:
- Emails (9 Nov, notes): a reshoot gets no develop reminder (gap, not a bug);
  the 1-headshot ready email preheader says "with your best pick".
- Public pages (8 Nov, notes): terms and refunds take their prices from the
  catalog, so ending the sale changes them without a new date (terms promise
  a new date and an email for important changes); a phone held sideways
  (844x390) shows the home buttons below the first screen; the free reshoot
  isn't mentioned on any public page.
- The square widening can attach after a shoot shows "done" and its ready
  email has gone (B-N13).
- Soro's blog script isn't named in the privacy policy (F4; owner chose to
  leave it, 6 Nov). Search only indexes titles and descriptions (F8).
- A refund worked out with the per-shoot price rounded up can leave one shoot
  on the account (C3-1).
- Linking Google from a second browser removes the password of a confirmed
  account (A1-07); a password sign-in to a Google-only account gives no hint
  to use Google (A1-06).
- If the server dies mid-render, those frames need a manual retry (B2-6).
- Reload mid-upload leaves a partial draft; the looks picker isn't a history
  entry (H8-10).

Low, left for later:
- AI outage uses up a shoot's free retries; a zero-headshot shoot then needs a
  manual refund.
- Results page: the viewer ignores the Retakes filter; arrow keys stop after
  tabbing to a download link; a download format changed in another tab isn't
  picked up; quick format switching on a slow network can disagree (H8-08);
  focus lost after opening the mobile menu, removing a photo, taking down a
  shared headshot, confirming an email, closing the selfie tips, and after
  pages that repaint in place (H8-01/04/06, partly fixed 3 Nov); the admin's
  "Download 1 headshot" saves two files.
- Billing: keep-plus for a deleted shoot still counts in unlocksPreviews; the
  "no room for looks" flag still adds extraLooks; millisecond races on a stale
  develop claim and delete-during-develop; a transient read error in the
  looksAsShoot guard; free-shoot release gap (free shoot off); developed flag
  not backfilled; legacy keep-plus shoot counted as a package lot (C3-2); a
  refund arriving before its payment is recorded (C3-3).
- Jobs: restore brings back a deleted account's funnel markers (G7-03); alert
  caps don't hold across servers (G7-04); backups leave out stats/refunds and
  takeovers (G7-05); clean-up steps ignore the time budget (G7-10); the funnel
  around daylight-saving changes (G7-11).
- Sign-in: the lock message's 15/30 minutes; a lost Google flow cookie during
  the delete re-check lands on /app silently (A1-04); a signed-out tab doesn't
  notice a sign-in elsewhere (A1-10); inconsistent answers while an account is
  being deleted (A1-12).
- Teams: renamed admin's old name on join/studio (D-07); invitations lapse only
  when something triggers it (D-06, partly fixed 3 Nov).
- Shoots: a stuck check past its lease is only recovered by polling (B2-7).
- UX: header doesn't collapse when text is enlarged on a short page (H8-11);
  blank page while a slow session request loads (H8-12).
- The home page footer year is fixed until prerender is re-run (F9).
