# Keeper Headshots

Upload a few selfies and get professional AI headshots back — checked, developed and graded by AI. Live at [keeperheadshots.com](https://keeperheadshots.com). The whole product is designed like a photographer's **contact sheet**; the tagline is *"Headshots worth keeping."*

![Landing](docs/landing.jpg)

## The core feature is real

A shoot runs through four AI steps. None of them use hardcoded answers.

| Step | Model | What it does |
| --- | --- | --- |
| **Photo check** | Claude (`claude-opus-5`, vision + structured output) | Scores each selfie for lighting, sharpness, face visibility and expression, flags issues (sunglasses, filters, blur), decides which photos to keep as references, and returns an overall verdict: *ready*, *usable* or *retake*. |
| **Develop** | Gemini image model (`gemini-3-pro-image`) | Renders each look (backdrop × outfit × pose take) from your kept reference photos, with a prompt built to preserve identity. Frames stream into the UI as they finish. |
| **Quality gate** | Claude | Checks every rendered frame against the reference selfies before it is shown: likeness feature by feature, plus professional finish (anatomy, hands, clothing, background, equipment, text, crop). It passes only at likeness ≥ 8 and polish ≥ 8 with no blocking issues (enforced in code). A failing frame is re-rendered with the gate's specific directions, up to `QA_ATTEMPTS` (default 3) within a 240 s budget; a frame that never passes is held back as a free retry. |
| **Retoucher review** | Claude | Compares every headshot with your originals, grades likeness, polish (AI artifacts) and lighting, labels each one *keeper*, *solid* or *retake*, suggests where to use it (LinkedIn, speaker bio…) and circles one **best pick**. |

Claude calls use the server-side refusal fallback (`fallbacks: "default"`), and the app handles refusals, rate limits, bad keys, partial failures (retry just the failed frames), server restarts mid-shoot (the shoot can be resumed) and a review that fails after rendering (retry grading only).

| Photo check | Graded proofs |
| --- | --- |
| ![Photo check](docs/photo-check.jpg) | ![Proofs](docs/proofs.jpg) |

## Run it

```bash
cd keeperheadshots
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY and GEMINI_API_KEY
npm start                 # http://localhost:3000
```

- **Demo account:** `demo@keeperheadshots.com` / `studio-demo`. It's seeded with two finished sample shoots so every screen has content. Sample images are illustrations and are labelled "Sample".
- Without API keys the app still runs. The studio shows an "AI studio is temporarily unavailable" banner, and the API returns `503 ai_not_configured` instead of pretending.
- Locally, data (users, shoots, images) lives in `./data` as JSON and files. Delete the folder to reset; the demo reseeds the next time someone signs in as the demo user.

### Deploying to Vercel

The same code runs on Vercel as an Express function:

- **Storage:** with a private Vercel Blob store connected (`BLOB_READ_WRITE_TOKEN`), all users, shoots and images live in Blob. Without it, the app uses `./data` on disk.
- **Rendering:** no long-lived background job. Each progress poll calls `advance()`, which claims pending frames up to `GENERATION_CONCURRENCY` and renders each one in the background of that request (`waitUntil`, up to 300 s). Claims are atomic in storage (`shoots.claimShot`: a Blob conditional write), so when several serverless instances poll the same shoot each frame still renders once; the worker's later writes carry its claim token (`shoots.writeShot`), so a worker that timed out can't overwrite a retry. Moving a shoot on to grading is also a conditional write, so it's graded once. Frames that stall past the lease are marked failed and can be retried.
- **Uploads:** photos go up one per request, so each body stays under Vercel's 4.5 MB limit.
- **Environment variables:** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `SESSION_SECRET` (required on Vercel), `BLOB_READ_WRITE_TOKEN` (added when the Blob store is connected), and optionally `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `OWNER_EMAILS`.

### Free trial and limits

Enforced on the server (`lib/plan.js`):

- **Free trial:** one free shoot per account, up to 2 looks (4 headshots).
- **After the trial:** developing needs a credit (`user.credits`); each paid shoot uses one. Stripe purchases add credits.
- **Free-account cap:** 6 completed photo checks in total.
- **Everyone except owners:** up to 2 re-grades per shoot.
- **Demo account:** read-only (browse the sample shoots only).
- **Owners:** emails listed in `OWNER_EMAILS` (comma-separated) have no limits.

### Payments (Stripe)

With `STRIPE_SECRET_KEY` set, the pricing buttons open Stripe Checkout (`lib/billing.js`). Packages live in `public/js/shared/catalog.js`:

| Package | Price | Shoots |
|---|---|---|
| Starter | $29 | 3 |
| Professional | $39 | 6 |
| Executive | $49 | 12 |

A paid shoot allows 4 looks (8 headshots). Purchases add credits to the account, and each developed shoot uses one. Payments are confirmed in up to three ways, recorded once per Checkout Session so a purchase is never credited twice:

- when the buyer returns to the dashboard after paying;
- on later dashboard visits, which catches a closed tab;
- optionally, a Stripe webhook: point it at `/api/billing/webhook` for `checkout.session.completed`, and set `STRIPE_WEBHOOK_SECRET`.

**Embedded checkout.** Set `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`, public by design) and `/app/buy/<package>` shows Stripe's payment form on our own page (Embedded Checkout, `ui_mode: "embedded_page"`, Stripe.js from `js.stripe.com/dahlia`). Without it, or if Stripe.js can't load, checkout falls back to Stripe's hosted page. Both return to `/app?checkout=success`, which confirms and grants the shoots (as does the webhook). For Apple Pay, register the domain in Stripe → Settings → Payment method domains.

### Example headshots

The photos on the landing page, sign-in screen and empty dashboard are rendered by the same image model and briefs as customer shoots (`lib/examples.js`). The people are fictional. The hero and retoucher sets start from a generated casual selfie that is then used as the reference photo, exactly like a customer's selfie. Images live in storage under `examples/` and are served from `/examples/<id>.jpg`, or resized as WebP from `/examples/<id>.webp?w=360|600|900` (what the pages use).

To (re)generate one, set a long random `ADMIN_TOKEN` in the environment, redeploy, then open `/api/admin/examples/<id>?token=…` (selfies first, since the other frames use them). `/api/admin/examples-sheet` returns a preview grid. Remove `ADMIN_TOKEN` afterwards and the admin routes disappear. After replacing an image, bump `v` in `example()` in `public/js/core.js` so browsers and the CDN fetch the new one.

### Contact form

`/contact` posts to `/api/contact` (`lib/contact.js`). Each message is saved to storage under `contact/`, then emailed to `CONTACT_TO` (default `hello@keeperheadshots.com`), with Reply-To set to the sender so you can answer straight from Gmail. Outgoing mail (`lib/mail.js`) goes through Resend's API when `RESEND_API_KEY` is set (the domain must be verified in Resend; from address `MAIL_FROM`, default `hello@keeperheadshots.com`), otherwise through ImprovMX SMTP with `SMTP_PASS`. Incoming mail to hello@ is still received and forwarded by ImprovMX. Without either key the form says it's offline and points people to the email address. A hidden honeypot field and a 5-per-hour limit per visitor keep spam down.

**Promotion codes**: checkout accepts Stripe promotion codes (create them in the Stripe dashboard under Product catalog → Coupons). A 100%-off code completes with "no payment required" and still grants the package; it isn't sent to Meta as a Purchase.

**Sales funnel** (`lib/stats.js`, page `/app/funnel`, owner accounts only): each person's first sign-up, confirmed email, photo check, developed shoot and purchase are counted per day in `stats/days/`, plus every purchase and its revenue after discounts. Demo and owner accounts aren't counted; visitors are in Vercel Analytics.

**"Your headshots are ready" email** (`lib/notify.js`): sent once per shoot when it finishes developing and grading, with a link to the results. Not for sample shoots, the demo account or unconfirmed addresses, and not after a regrade.

**Customer results** (`lib/showcase.js`): on a finished shoot, a customer can offer one headshot with a first name, job and short quote, ticking a permission box (`POST /api/showcase`). The owner gets an email and approves or declines at `/app/showcase`; the home page's "From our customers" section appears only when at least one is approved (up to 6, `GET /api/showcase`). A copy of the headshot is kept under `showcase/`; taking it down (results page or Account), deleting the shoot or deleting the account removes it, and the CDN drops it within about 10 minutes.

**Render limits**: each shoot renders at most 2 frames at a time (`GENERATION_CONCURRENCY`), and the whole site at most `RENDER_SLOTS` (default 4, `lib/slots.js`) across all shoots and servers, so Gemini's per-minute image quota isn't tripped when several people develop at once. Frames past the limit wait as "Queued" and the studio says the shoot is next in line.

**Backups** (`lib/backup.js`): a nightly cron (`/api/cron/backup`, 03:43 UTC) saves every account, payment, refund, claim, usage, shoot and frame record, contact message and funnel count as one gzipped snapshot, `backups/<date>.json.gz`, keeping the last 30 (`BACKUP_KEEP_DAYS`). With a second, private Blob store connected with the env prefix `BACKUP` (`BACKUP_STORE_ID`, reached with the project's Vercel OIDC token, or `BACKUP_READ_WRITE_TOKEN`) they go to that store; otherwise, or if that store can't be reached that night, to the main one (with an alert). Photos aren't included. To restore: `node scripts/restore-backup.js` shows what's in the newest snapshot; add `--only users/`, `--missing` (never overwrite) and `--apply` to write.

**Previews vs. the live site**: preview builds share the live Blob store, so everything they write goes under `preview/` (`STORAGE_NAMESPACE`), apart from live customer data; example headshots are shared. Stripe keys must match: a live key (`sk_live_`) only works on production and a test key (`sk_test_`) only elsewhere; a mismatched key turns payments off and is reported. With a test key on Preview, the buy page says it's test mode and gives Stripe's test card.

**Reminder emails** (`lib/reminders.js`): after the daily clean-up, the same cron sends at most two reminders per account, ever: "develop" (photos passed the check but nothing developed, 1 to 14 days later), and one of "checkout" (started a checkout without finishing it and never bought, 1 to 7 days later, linking back to that package) or "buy" (free shoot developed, nothing bought, 2 to 21 days later). Never to unconfirmed, demo or owner accounts, and at most `REMINDERS_PER_DAY` (default 30) a day so they can't crowd out confirmations and password resets. Every reminder has a signed unsubscribe link (`/unsubscribe`) and one-click unsubscribe headers (RFC 8058); people can also switch them off on the account page.

**Error alerts** (`lib/alert.js`): in production, anything logged with `console.error` (what Vercel counts as a runtime error) is gathered for 20 seconds and emailed as one summary to `ALERT_EMAIL` (default `CONTACT_TO`), at most `ALERTS_PER_HOUR` (default 4) emails an hour and `ALERTS_PER_DAY` (default 10) a day across all servers, so alerts can't use up Resend's daily allowance. `ALERTS=off` turns them off; `ALERTS=on` enables them outside production.

### Flow

`/` landing (and `/contact`) → `/signup` or `/signin` → `/app` (your shoots) → `/app/new` (upload) → `/app/shoot/:id`, which moves through **Photo check → Looks → Develop → Proofs** based on the shoot's server-side status.

**Team orders** (`lib/teams.js`, `/app/team`, `/join`): a buyer names a team, picks its looks and invites colleagues by email (`POST /api/team/invites`). Each invite sets aside one of the buyer's shoots (returned if the invite is cancelled, or if the member deletes their team shoot before developing). The emailed link `/join/<token>` is moved into sessionStorage and the address rewritten to `/join` before anything else loads, so the secret never reaches analytics. The colleague signs in or up with the invited address (which also confirms it) and gets a paid shoot fixed to the team's looks. The buyer sees each person's progress and can download their finished headshots, never their selfies. Records: `teams/<id>.json` and `invites/<token>.json`; `scripts/dev/team-tests.js` covers it.

**Profile kit**: besides the portrait and square, each finished headshot can be downloaded as `?size=linkedin` (800×800 JPEG), `?size=banner` (1584×396 LinkedIn banner made from the headshot's backdrop) and `?size=signature` (256px round PNG with a transparent background, for email signatures), each cached next to the original (`-li.jpg`, `-banner.jpg`, `-sig.png`).

## Design direction: "Studio Heritage"

The brand is about replacing a photo studio, so the UI borrows a studio's own artifacts: contact sheets with frame numbers, prints with captions, and the grease-pencil loop a photographer draws around the keeper frame.

- **Palette:** Ink Navy `#14213D` is the dominant tone, on Ivory `#F7F3EA`. Brass `#B8893B` (and deep brass `#8C6A2C` for text) marks the viewfinder, highlights and the "best pick" loop. Oxblood `#7A2E2E` is kept for featured moments: badges, the popular package and offers. Stone `#6B665B` is the neutral. Semantic success, warning and danger colors cover grades.
- **Type:** *Fraunces* for display (editorial, with italics for emphasis), *Figtree* for UI and body, *IBM Plex Mono* for frame numbers, labels and data, with tabular numbers.
- **System:** everything is driven by CSS tokens in `public/css/app.css`: a fluid type scale, a 4px spacing scale, radius, shadow and motion tokens (`--ease-out`, `--ease-spring`, and no linear easing except spinners). There is a film-grain overlay, and gradient-mesh lighting on dark surfaces.
- **Dark theme:** follows the device setting (`prefers-color-scheme`). The dark palette at the end of `app.css` redefines the tokens: a deep navy-charcoal ground `#0F1420`, ivory text, brighter brass and oxblood. Use the role tokens, not raw colours: `--ink`/`--on-ink` for strong text, selected borders and solid chips (they invert in dark), `--night` for panels that stay dark in both themes (contact sheet, verdict, lightbox, toasts, CTA bands), and `--photo-paper` for print borders. Prints, polaroids and the business-card/CV mockups are *light islands*: they stay paper-coloured, and the dark block restores light-theme text colours inside them (add `.light-island` to any other light card).
- **Motion:** a staggered hero reveal with the grease-pencil circle drawing itself in, scroll reveals, a scanning skeleton during the photo check, and frames "developing" out of a sepia blur. `prefers-reduced-motion` turns all of it off.
- **States:** skeleton loaders, empty dashboard, form validation, API errors, AI-not-configured, partial render failures, grading failure, 404, and disabled, hover, focus and pressed states on every control.

- **Logo:** a Fraunces serif "K" framed by brass viewfinder corners, beside "Keeper" in Fraunces semibold over "HEADSHOTS" in tracked Figtree caps. Tagline: "Headshots worth keeping."

## SEO

- `lib/seo.js` builds every HTML response from `templates/index.html`: per-page title, description, canonical URL (always https://keeperheadshots.com), robots rule, and JSON-LD on the home page (Organization, WebSite, Service with the package prices, FAQPage from `public/js/shared/faq.js`). App pages (`/app/*`, `/signin`, `/verify`) are `noindex`; unknown paths return a real 404; trailing slashes 301 to the canonical path; `*.vercel.app` hosts get `X-Robots-Tag: noindex`.
- Social previews: the home page and each landing page have their own 1200×630 `og:image`, `/og/<slug>.png` (`lib/og.js`): a text panel prerendered with the site fonts (`npm run og` → `assets/og/`, re-run after changing `OG_PAGES`) plus two of the page's example headshots, added from storage when first requested. Other pages use `public/og.png`.
- Blog: `/blog` (and `/blog/<slug>` article addresses) shows articles written by Soro through its embed script (`public/js/views/blog.js`, embed URL `SORO_EMBED`). Only /blog pages allow Soro in their Content Security Policy (server.js `BLOG_CSP`), so links to and from the blog load the page fresh instead of going through the in-app router. The server sends Soro's snippet in the /blog page itself (`lib/seo.js`, embed URL in `public/js/shared/soro.js`); the app keeps that same `#soro-blog` element when it takes over, so Soro's script runs once per page load. The prerendered copy has the empty div, never loaded articles.
- Every headshot is also downloadable as a 1:1 square for LinkedIn / Microsoft Teams (`GET /media/<sid>/<file>?square=1`), which show it as a circle. The render brief asks for centered framing with headroom; the quality gate reports the head's position. If a passed frame is tight for a circle, the pipeline asks the image model to widen it into a square with breathing room and re-checks it (likeness, finish, framing) before attaching it as `shot.square`. Otherwise the square is a face-centered crop of the portrait, cached as `<file>-sq.jpg`.
- Download format: each account picks Portrait 3:4, Square 1:1 or Both (`user.photoFormat`, default both; `POST /api/account/preferences`), on the results page or in Account. It only sets what the download buttons give; both shapes are always available (`public/js/views/format.js`).
- `/linkedin-headshots`, `/team-headshots`, `/real-estate-headshots`, `/resume-headshots`, `/doctor-headshots` and `/lawyer-headshots` are search landing pages (the team page's matching example team is `team-1`…`team-6`, the example agents `re-1`…`re-4`, the job seekers `cv-1`…`cv-4` and the clinicians `md-1`…`md-4`, the attorneys `lw-1`…`lw-4`, with `-sq` squares, in `lib/examples.js`) (`public/js/views/linkedin.js`, FAQ in `public/js/shared/faq.js`, JSON-LD in `lib/seo.js`).
- Public pages ship prerendered content from `lib/prerendered.js` so crawlers that don't run JavaScript see the page. **After changing copy on a public page, run the server and `npm run prerender`, then commit `lib/prerendered.js`.** Adding a public page means adding it to `PAGES` in `lib/seo.js` and to `public/sitemap.xml`.

## Before launch

- Placeholder testimonials were removed. Add real customer quotes (with permission) once you have them.
- The money-back guarantee's terms live at `/refunds` (`public/js/views/refunds.js`). Refunds are issued in the Stripe dashboard; the next dashboard visit by that customer removes the refunded package's credits automatically (`lib/billing.js`).
- `hello@keeperheadshots.com` is live (ImprovMX forwarding; Gmail "Send mail as").
- Privacy Policy (`/privacy`) and Terms (`/terms`) live in `public/js/views/legal.js`. Update them whenever data handling changes (new provider, new tracking, retention). They are plain-English drafts; have a lawyer review them.
- Sign-up is protected by Cloudflare Turnstile when `TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY` (sensitive) are both set (`lib/turnstile.js`, `public/js/turnstile.js`). The widget is invisible unless Cloudflare wants a click. The server checks the token before anything else, including whether the email already exists. If Cloudflare is unreachable, sign-up is allowed and email confirmation still guards the free shoot.
- New accounts must confirm their email before the free shoot (and free photo checks) unlock: sign-up emails a signed link (`/verify?token=…`, valid 3 days) through the same provider as the contact form (`lib/mail.js`). Resends are limited to 1/minute and 5/day. Meta's `CompleteRegistration` fires on confirmation, not sign-up. Accounts created before this change count as confirmed. Without an email provider the link is logged instead of sent.
- Storage clean-up: a daily Vercel Cron (`vercel.json` → `GET /api/cron/cleanup`, authorized by `CRON_SECRET`) deletes orphaned shoot files (`media/<sid>/`, `shots/<sid>/` whose shoot no longer exists) and contact-form copies older than 12 months (`lib/cleanup.js`). The renderer also deletes an image it saved if its frame or shoot is gone by then.
- Password reset: "Forgot password?" on sign-in goes to `/forgot-password`, which emails a link to `/reset` (`POST /api/auth/password/forgot` and `/api/auth/password/reset`). Links last 1 hour and work once, because the signature covers the current password hash. Each account gets at most 3 reset emails an hour. A reset signs out every other device: sessions carry the user's `sessionVersion`, which a reset or "Sign out of other devices" on `/app/account` (`POST /api/auth/signout-all`) increments.
- Customers can delete their account at `/app/account` (`POST /api/account/delete`, password required). It removes the user, every shoot and all media; only a hashed-email record of free-shoot usage (`users/deleted/`) and payment records (`payments/`) remain, as the privacy policy states.
- Meta tracking honours Global Privacy Control: no Pixel when `navigator.globalPrivacyControl` is set, and no Conversions API events for requests with `Sec-GPC: 1` (purchases carry the flag through Stripe checkout metadata).

## Project layout

```
server.js                 Express app: auth, shoots API, media, static SPA
lib/ai.js                 Claude photo check + review, Gemini rendering, prompts
lib/pipeline.js           Shoot orchestration, concurrency, retries, recovery
lib/storage.js            disk or Vercel Blob backend
lib/store.js, lib/auth.js data model, scrypt passwords, signed-cookie sessions
public/js/views/*         landing, auth, dashboard, studio (the shoot flow)
public/js/shared/*        style catalog + sample portrait illustrations (browser + server)
scripts/seed.js           demo account and sample shoots
scripts/dev/*             QA only: local API test double, API e2e, screenshot runner
```

### Layout audit (run on every QA pass)

`scripts/dev/layout-audit.mjs` loads every public page and every app state (dashboard, each shoot step, proofs, the photo viewer, account, checkout, team admin and invitations, funnel) at 320, 375, 390, 412, 768, 1024, 1280 and 1440px. It reports:

- a page that scrolls sideways;
- text cut off or running off the screen;
- uneven gaps between items of the same kind in a row (spaced by their visible text, or by their centres when centred);
- one item left alone on a wrapped row (2 + 1);
- overlapping neighbours;
- same-size buttons side by side at different heights.

It also saves a full-page screenshot of every state at 390 and 1280px (`<outDir>/shots`). **Look at those too**: the audit measures, but it can't judge everything a person notices.

It also watches the wardrobe strip in motion, with its clock sped up so a full loop fits in about ten seconds. It checks card positions and the actual pixels, and reports a strip that stands still or shows a gap, including cards that are in place but not drawn (what iPhone Safari did).

It runs automatically on GitHub (`.github/workflows/layout.yml`) in both Chromium and WebKit (Safari's engine): on every push to main, on pull requests and nightly. Each run keeps the report and screenshots as a build artifact for 14 days. Locally, `bash scripts/dev/layout-ci.sh [chromium|webkit]` does the same setup. To run the audit by hand instead, point it at a server with a fresh `DATA_DIR`, wired to the mock, with `audit-owner@example.com` in `OWNER_EMAILS`. It exits 1 if it finds anything. Sample photos are replaced with stand-in portraits of the right shape, so broken images don't distort the layout. The film grain is hidden in its screenshots: it's fixed to the screen, so a full-page capture would otherwise show a false "seam" one screen down.

### QA without spending API credits

`scripts/dev/mock-ai.js` is a local stand-in for the Anthropic and Gemini HTTP APIs. The app uses it only if you explicitly point the base URLs at it, so the real SDK code paths, parsing, polling and every UI state can be exercised offline:

All of the suites below run on every push via GitHub Actions (`.github/workflows/ci.yml`);
`bash scripts/dev/ci.sh` runs the same thing locally (it starts the mock and two servers itself).

```bash
npm run mock-ai &
ANTHROPIC_API_KEY=test GEMINI_API_KEY=test \
ANTHROPIC_BASE_URL=http://localhost:4010 GEMINI_BASE_URL=http://localhost:4010 PORT=3100 npm start &
node scripts/dev/api-e2e.js   # add RESEND_API_KEY=test RESEND_BASE_URL=http://localhost:4010 to the server to test the Resend path
node scripts/dev/screenshots.js shots   # phone (390px) + desktop (1440px) click-through
node scripts/dev/layout-audit.mjs audit   # every page and app state at 8 widths (see below)
node scripts/dev/race-tests.js   # double-spend, lockout, open-redirect and other regression checks
node scripts/dev/reset-tests.js  # password reset and sign-out-everywhere checks
node scripts/dev/hardening-tests.js  # verify links, sign-ins, photo edits/checks, checkout and contact limits, sign-out
                                     # (set DATA_DIR to the server's to include the re-check and demo sign-out tests)
node scripts/dev/cleanup-tests.js    # daily clean-up on a throwaway local store (no server needed)
node scripts/dev/reminder-tests.js   # reminder emails: who's due, one-click unsubscribe, account switch
node scripts/dev/showcase-tests.js   # customer results: permission, approval, take-down
node scripts/dev/backup-tests.js     # nightly backup and restore, same (no server needed)
node scripts/dev/env-tests.js        # preview storage namespace and Stripe key modes (no server needed)
node scripts/dev/alert-tests.js      # error alert emails (needs the mock on :4010)
MOCKLOG=mock.log RENDER_SLOTS=3 node scripts/dev/slots-test.js  # site-wide render limit (servers with RENDER_SLOTS=3)
node scripts/dev/growth-tests.js     # promotion codes and the owner's funnel (funnel-owner@example.com in OWNER_EMAILS)
                                   # (set ADMIN_TOKEN on the server and QA_ADMIN_TOKEN here to test the admin header)
# Two instances at once: run two servers on one DATA_DIR (ports 3100 + 3101), mock started with
# MOCK_QA_FAIL=none and its output in MOCKLOG; each frame must render once and grade once:
MOCKLOG=mock.log node scripts/dev/render-race.js
# Add EMAIL=someone@x.com (listed in both servers' OWNER_EMAILS, a new address each run) for an
# 8-frame shoot; maxInflight in the output must stay at 2 (the render limit).
node scripts/dev/csp-sweep.mjs   # every public page at 1280px and 390px: console/CSP errors, broken images, overflow
```
