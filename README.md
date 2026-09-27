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

### Example headshots

The photos on the landing page, sign-in screen and empty dashboard are rendered by the same image model and briefs as customer shoots (`lib/examples.js`). The people are fictional. The hero and retoucher sets start from a generated casual selfie that is then used as the reference photo, exactly like a customer's selfie. Images live in storage under `examples/` and are served from `/examples/<id>.jpg`, or resized as WebP from `/examples/<id>.webp?w=360|600|900` (what the pages use).

To (re)generate one, set a long random `ADMIN_TOKEN` in the environment, redeploy, then open `/api/admin/examples/<id>?token=…` (selfies first, since the other frames use them). `/api/admin/examples-sheet` returns a preview grid. Remove `ADMIN_TOKEN` afterwards and the admin routes disappear. After replacing an image, bump `v` in `example()` in `public/js/core.js` so browsers and the CDN fetch the new one.

### Contact form

`/contact` posts to `/api/contact` (`lib/contact.js`). Each message is saved to storage under `contact/`, then emailed to `CONTACT_TO` (default `hello@keeperheadshots.com`), with Reply-To set to the sender so you can answer straight from Gmail. Outgoing mail (`lib/mail.js`) goes through Resend's API when `RESEND_API_KEY` is set (the domain must be verified in Resend; from address `MAIL_FROM`, default `hello@keeperheadshots.com`), otherwise through ImprovMX SMTP with `SMTP_PASS`. Incoming mail to hello@ is still received and forwarded by ImprovMX. Without either key the form says it's offline and points people to the email address. A hidden honeypot field and a 5-per-hour limit per visitor keep spam down.

### Flow

`/` landing (and `/contact`) → `/signup` or `/signin` → `/app` (your shoots) → `/app/new` (upload) → `/app/shoot/:id`, which moves through **Photo check → Looks → Develop → Proofs** based on the shoot's server-side status.

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

### QA without spending API credits

`scripts/dev/mock-ai.js` is a local stand-in for the Anthropic and Gemini HTTP APIs. The app uses it only if you explicitly point the base URLs at it, so the real SDK code paths, parsing, polling and every UI state can be exercised offline:

```bash
npm run mock-ai &
ANTHROPIC_API_KEY=test GEMINI_API_KEY=test \
ANTHROPIC_BASE_URL=http://localhost:4010 GEMINI_BASE_URL=http://localhost:4010 PORT=3100 npm start &
node scripts/dev/api-e2e.js   # add RESEND_API_KEY=test RESEND_BASE_URL=http://localhost:4010 to the server to test the Resend path
node scripts/dev/screenshots.js shots   # phone (390px) + desktop (1440px) click-through
node scripts/dev/race-tests.js   # double-spend, lockout, open-redirect and other regression checks
node scripts/dev/reset-tests.js  # password reset and sign-out-everywhere checks
# Two instances at once: run two servers on one DATA_DIR (ports 3100 + 3101), mock started with
# MOCK_QA_FAIL=none and its output in MOCKLOG; each frame must render once and grade once:
MOCKLOG=mock.log node scripts/dev/render-race.js
node scripts/dev/csp-sweep.mjs   # every public page at 1280px and 390px: console/CSP errors, broken images, overflow
```
