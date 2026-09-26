# HeadshotPro — rebuilt

A working rebuild of [headshotpro.com](https://www.headshotpro.com): upload a few selfies and get professional AI headshots back. It keeps the brand's promise, "professional headshots without the photo shoot", and adds a clearer point of view: the whole product is designed like a photographer's **contact sheet**.

![Landing](docs/landing.jpg)

## The core feature is real

A shoot runs through three AI steps. None of them use hardcoded answers.

| Step | Model | What it does |
| --- | --- | --- |
| **Photo check** | Claude (`claude-opus-5`, vision + structured output) | Scores each selfie for lighting, sharpness, face visibility and expression, flags issues (sunglasses, filters, blur), decides which photos to keep as references, and returns an overall verdict: *ready*, *usable* or *retake*. |
| **Develop** | Gemini image model (`gemini-3-pro-image`) | Renders each look (backdrop × outfit × pose take) from your kept reference photos, with a prompt built to preserve identity. Frames stream into the UI as they finish. |
| **Retoucher review** | Claude | Compares every headshot with your originals, grades likeness, polish (AI artifacts) and lighting, labels each one *keeper*, *solid* or *retake*, suggests where to use it (LinkedIn, speaker bio…) and circles one **best pick**. |

Claude calls use the server-side refusal fallback (`fallbacks: "default"`), and the app handles refusals, rate limits, bad keys, partial failures (retry just the failed frames), server restarts mid-shoot (the shoot can be resumed) and a review that fails after rendering (retry grading only).

| Photo check | Graded proofs |
| --- | --- |
| ![Photo check](docs/photo-check.jpg) | ![Proofs](docs/proofs.jpg) |

## Run it

```bash
cd headshotpro
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY and GEMINI_API_KEY
npm start                 # http://localhost:3000
```

- **Demo account:** `demo@headshotpro.app` / `studio-demo`. It's seeded with two finished sample shoots so every screen has content. Sample images are illustrations and are labelled "Sample".
- Without API keys the app still runs. The studio shows a clear "AI isn't switched on" banner, and the API returns `503 ai_not_configured` instead of pretending.
- Data (users, shoots, images) lives in `./data` as JSON and files. Delete the folder to reset; the demo reseeds on the next start.

This is a long-running Node server: rendering happens in the background while the browser polls. Deploy it to a Node host with a persistent disk (Render, Fly, Railway, a VM) rather than serverless functions.

### Flow

`/` landing → `/signup` or `/signin` → `/app` (your shoots) → `/app/new` (upload) → `/app/shoot/:id`, which moves through **Photo check → Looks → Develop → Proofs** based on the shoot's server-side status.

## Design direction: "Studio contact sheet"

The brand is about replacing a photo studio, so the UI borrows a studio's own artifacts: contact sheets with frame numbers, prints with captions, and the orange grease-pencil loop a photographer draws around the keeper frame.

- **Palette:** ink navy `#0B1320` is the dominant tone, on warm backdrop paper `#F5F1EA`. There is one sharp accent, a tungsten-flash orange `#FF5B2E`, used only for primary actions and the "best pick" mark. Teal `#0E7F78` is a quiet brand/trust color (stars, verified, likeness bars). Semantic success, warning and danger colors cover grades.
- **Type:** *Instrument Serif* for display (editorial, with italics for emphasis), *Plus Jakarta Sans* for UI and body (HeadshotPro's own family, kept for brand continuity), *IBM Plex Mono* for frame numbers, labels and data, with tabular numbers.
- **System:** everything is driven by CSS tokens in `public/css/app.css`: a fluid type scale, a 4px spacing scale, radius, shadow and motion tokens (`--ease-out`, `--ease-spring`, and no linear easing except spinners). There is a film-grain overlay, and gradient-mesh lighting on dark surfaces.
- **Motion:** a staggered hero reveal with the grease-pencil circle drawing itself in, scroll reveals, a scanning skeleton during the photo check, and frames "developing" out of a sepia blur. `prefers-reduced-motion` turns all of it off.
- **States:** skeleton loaders, empty dashboard, form validation, API errors, AI-not-configured, partial render failures, grading failure, 404, and disabled, hover, focus and pressed states on every control.

## Brand notes from the reference

The live site was blocked from the build sandbox. The brand DNA below comes from public reviews and listings, plus the site's known type family:

- **Promise:** studio-quality business headshots from selfies, in under an hour, with no photographer.
- **Proof points:** 18M+ headshots, 197k+ customers, 4.8★ on Trustpilot, 100% money-back guarantee.
- **Pricing:** $29 / $39 / $49 one-time packages (40 / 120 / 240 headshots), and team pricing at $39 per person.
- **Tone:** plain, confident and reassuring. The copy focuses on saving time and money.

Hex values are reconstructed rather than sampled from live CSS. Testimonials in the landing page are placeholder copy; replace them with real reviews before launch.

## Project layout

```
server.js                 Express app: auth, shoots API, media, static SPA
lib/ai.js                 Claude photo check + review, Gemini rendering, prompts
lib/pipeline.js           Shoot orchestration, concurrency, retries, recovery
lib/store.js, lib/auth.js JSON store, scrypt passwords, signed-cookie sessions
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
node scripts/dev/api-e2e.js
node scripts/dev/screenshots.js shots   # phone (390px) + desktop (1440px) click-through
```
