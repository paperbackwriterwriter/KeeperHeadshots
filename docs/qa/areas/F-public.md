# F-public: public pages and routes (auditor zz-f6, ports 3616/4616/2616)

Repo /home/user/keeperheadshots @ d1c7ac7. Stack: start-stack.sh 3616 4616 2616 (free shoot off). Blog checked against a sample RSS feed served on 4616 with the app on 3616 (SORO_FEED_URL, BLOG_ALLOW_LOCAL=1): a copy of scripts/dev/blog-tests.js on my ports passed 61/61, plus a browser pass. All zz-f6-* scripts are deleted and the stack is stopped.

## 1. Inventory

### Routes and server behaviour
| Item | How checked | Result |
|---|---|---|
| `/` 200, title, desc, canonical, robots index, og:url/og:image /og/home.png, JSON-LD (Organization, WebSite, Service+3 Offers, FAQPage) | curl + browser crawl | OK. Meta desc is 173 chars (known) |
| `/linkedin-headshots`, `/team-headshots`, `/real-estate-headshots`, `/resume-headshots`, `/doctor-headshots`, `/lawyer-headshots`: 200, own og image, Service+FAQPage+BreadcrumbList | crawl | OK |
| `/contact`, `/refunds`, `/privacy`, `/terms`, `/signup` (indexable), `/blog` | crawl | OK. `/refunds` desc is 174 chars (known) |
| `/signin`, `/forgot-password`, `/verify`, `/reset`, `/join`, `/unsubscribe`: noindex,nofollow, no og:url, client titles | crawl | OK |
| Unknown path: real 404, noindex; client "This frame didn't develop." | crawl | OK |
| `//evil.com`, backslash paths: 404, no redirect | curl | OK |
| Trailing slash: 301 to clean path, query kept | curl | OK |
| `/pricing`, `/faq`: 308 to `/#pricing`, `/#faq` | curl | OK, but the query string is dropped: F7 |
| Non-canonical host: X-Robots-Tag noindex (vercel.app, www) | curl with Host header | OK |
| robots.txt (Disallow app/api/media/verify/ads; both sitemaps) | curl + read | OK |
| sitemap.xml: 13 URLs = seo.js PAGES; lastmod against git history of each page's prerendered content | per-commit hash of lib/prerendered.js per page | OK (signup 10-24, privacy/terms 11-01, refunds/landings 11-02 all match the last content change; contact unchanged) |
| /blog/sitemap.xml (empty feed: valid empty urlset; sample feed: both posts with lastmod) | curl, sample feed | OK |
| llms.txt: prices, shoots, looks, headshots, guarantee, retention, pages | read against catalog/cleanup/backup | OK |
| /og/<slug>.png for 7 slugs, unknown slug 404, cache headers; images show "From $14.50" | curl + viewed images | OK (example frames empty locally: known /examples/ 404) |
| /og.png (static: no price) | viewed | OK |
| favicon.ico, favicon.svg, apple-touch-icon; no manifest referenced | curl + template | OK |
| /ads images (no price claims) | viewed | OK |
| lib/prerendered.js identical to the live client render (all 13 PAGES) | re-captured with prerender.js logic, string compare | OK: all SAME |
| Home page hydrate keeps server markup (signed-in: nav + /signup hrefs only) | code read app.js:183-230, landing.js:307 | OK; footer year then stays as prerendered: F9 |
| JSON-LD parses on every page; FAQPage questions and answers equal the visible FAQ on all 7 FAQ pages | crawl compares ld vs details | OK |
| Blog with no feed: /blog embed + prerendered shell; /blog/<slug> 200 noindex canonical /blog; /blog?post= noindex | curl | OK |
| Blog from feed: index, article (title, canonical, description, og article image, BlogPosting, breadcrumbs), 404 article page, ?post= 301, uppercase 301, images, sitemap, cron sync, unpublish, empty or failed feed kept | blog-tests copy 61/61 + browser | OK |
| Blog client takes over the SSR main (title kept, footer added), CTA "/#pricing" link, link rewriting | browser | OK |
| Blog CTA copy "Packages start at $14.50 … money-back guarantee" | read | OK |
| /api/search: pages, home sections, 7 FAQ lists, 3 packages, blog posts; 30 sample queries | curl | Works; coverage gaps: F8 |
| Search UI: result click opens and focuses the FAQ answer on another page; Enter and arrow keys | browser (4 cases) + code | OK |
| Contact: client validation and focus; topic from ?topic=; team card switches topic; honeypot; server validation; 5/hour per IP; "Send another" | browser + curl | OK |
| Contact: what the owner receives (Reply-To the customer, topic label in subject, signed-in line, text) | mock mail | OK; a name like "Ann\nBcc: x" is flattened to one line, no header injection |
| Contact: Turnstile (contact action), contact offline 503, storage copy, 12-month cleanup | code read (Turnstile not configured locally) | OK; rate limit is counted before the bot check: F6 |
| Signup/signin/forgot-password copy; Turnstile on signup/reset/contact as privacy says | browser text + code | OK ("Step 1 of 3" has no step 2 or 3 label anywhere; cosmetic, not filed) |
| Internal links on all public pages (59 unique): status and anchors | crawl | OK, all 200/302, anchors exist |
| Console errors on public pages | crawl | none |
| Typos and grammar (whole visible text of 15 pages: repeated words, spacing, punctuation; manual read of all copy sources) | script + read | none found |

### Claims in copy, checked against code
| Claim (where) | Code | Result |
|---|---|---|
| Starter $14.50 (was $29) 3 shoots, Professional $19.50/$39 6, Executive $24.50/$49 12 (home, team, FAQ, JSON-LD, llms, search, og, descriptions) | catalog.js PACKAGES | OK |
| "From $14.50", "~$2 / about $2 a person", per-person $4.83/$3.25/$2.04 | FROM_PRICE, ABOUT_PER_PERSON | OK |
| Preview reminder email "Packages from $29" / "start at $29" | mail.js:245,252 | **F1** |
| Keep pick $8.99, keep all + 2 looks $14.99 (terms, refunds, emails) | PREVIEW_OFFERS | OK as stated; pricing anomaly **F2** |
| 4 looks × 2 takes = 8 headshots per shoot; up to 24/48/96 | MAX_LOOKS, TAKES_PER_LOOK | OK |
| 1–6 selfies | MIN/MAX_SELFIES | OK |
| 6 backdrops, 9 outfits; every named look exists; example captions match the example prompts (strip, re, cv, md, lw, team) | catalog.js, examples.js | OK |
| White Coat / Scrubs offered to everyone; no badges or logos | studio.js lists all OUTFITS; prompts | OK |
| Anything that drifts is retaken automatically | pipeline.js QA_ATTEMPTS=3 | OK |
| "3 AI passes on every shoot" (README says four AI steps; generation not counted) | pipeline | OK (check, gate, review) |
| < 15 min / a few minutes / in minutes | not measurable locally | OK (no contradiction between pages) |
| Portrait 3:4 + square 1:1; format portrait/square/both, switch on results page or account | format.js, account.js, studio.js | OK; LinkedIn "Both versions download together": **F10** |
| LinkedIn ≥400×400 square; linkedin 800×800 size | server.js SIZES | OK |
| No watermark on paid shoots | preview.js | OK |
| Free retries up to 3 per shoot (terms, refunds) | MAX_RESUMES=3 | OK |
| Re-grade (refunds "you can re-grade a shoot") | FREE.regradesPerShoot=2 | OK |
| Money-back guarantee: first package, first paid shoot, 30 days, less later kept shoots, once per person, team same (FAQ, home, refunds, llms, emails, seo desc) | text consistent everywhere; refunds worked example $19.50/$3.25/$16.25 | OK |
| Free shoot offered until October 2026 (privacy) | git: off since 2026-10-17 | OK |
| Package unlocks previews (terms) | preview.js unlocksPreviews | OK |
| Unused shoots don't expire while the account is open | cleanup deletes only undeveloped drafts (no credit used) | OK |
| Team: admin names team, picks up to 4 looks, invites by pasted emails, each invite uses one shoot, cancelled or 90-day lapsed invite returns it, member must sign in with invited address, delete before develop returns seat, up to 100 invites | teams.js, teamadmin.js, server.js:1377 | OK |
| Team: admin can "download everyone's finished headshots" (team page, FAQ, privacy, invite email) | | known (best pick only) |
| Team: admin never sees selfies | teams | OK |
| Cookies in privacy vs set: ahg_session 30d, kh_device 1y, kh_origin 1y, kh_google 10 min, kh_reauth 5 min, Meta _fbc/_fbp | auth.js, google.js, pixel.js | OK |
| Session storage (autocheck, join token, search FAQ), local storage (photo tips) | grep of public/js | OK |
| Vercel Web Analytics, cookieless, production host only | app.js loadAnalytics | OK |
| GPC: no pixel, no server events | pixel.js, meta.js | OK |
| Meta server events: registration, checkout, purchase; hashed email + id, IP, UA | meta.js | OK |
| Turnstile on sign-up, contact, password reset | server.js 196/586/1792 | OK |
| Providers listed vs used: Vercel, Anthropic, Google (Gemini, sign-in), Stripe, Cloudflare, Resend, ImprovMX/Gmail, Meta | code | Resend "receipts" and Soro missing: **F4** |
| Retention: drafts 90 d, photo backups ≤7 d, record backups ≤30 d, contact 12 months, rate counters 2 d, invites 90 d | cleanup.js, photo-backup.js, backup.js, ratelimit | OK |
| Shared headshot disappears within about 10 minutes | showcase cache 60 s, image s-maxage 600; home HTML CDN SWR 86400 | **F5** |
| Reply within one business day (contact meta, refunds) | consistent | OK |
| Legal entity: emails "Keeper Headshots LLC, Johnston IA"; terms/privacy "Keeper Headshots, based in Iowa" | mail.js POSTAL_ADDRESS | fixed 6 Nov: Terms and privacy name Keeper Headshots LLC |
| Policy dates: privacy/terms Nov 1, refunds Nov 2, matching sitemap | | OK |

### Added at the nightly re-check of 8 Nov 2026

All 47 items above were re-checked on 8 Nov (45 pass, 2 changed by design: the sale ad images, the LLC name; F1, F2, F6, F7, F10, F11 confirmed fixed). New items:

| Id | Item | How | Result (8 Nov) |
|---|---|---|---|
| F-N1 | Server title for every app route matches the app's, including /join and /join/<token> | curl titles vs app.js | /join had the generic title; fixed 8 Nov |
| F-N2 | What the team admin sees is described the same everywhere (FAQ, team page, privacy, join page, invite email): the headshot each person chooses | grep + team-tests | Privacy, join page and invite email said "finished headshots"; fixed 8 Nov (privacy dated November 8) |
| F-N3 | Every package and preview-offer price shows the sale price with the full price crossed out (home, team, buy, studio); JSON-LD, llms.txt, search and social images show the sale price | grep wasPrice + crawl | OK |
| F-N4 | Home CDN cache max-age=60, stale-while-revalidate=540; other pages 86400 | curl -I | OK |
| F-N5 | Footer "Your shoots": none signed out, one signed in, on every marketing page incl. the hydrated home page | two-context crawl | OK |
| F-N6 | Foldables and sideways phones: no sideways scroll at 626x890, 890x626, 844x390; home buttons on the first screen at 890x626 | Playwright | OK |
| F-N7 | Sale ad images match the catalog prices | view | OK |
| F-N8 | When the sale ends (catalog price change): llms.txt, ad images, social images, prerender, policy dates (terms and refunds build prices from the catalog) and the sitemap all change together | checklist step on any catalog price change | note |
| F-N9 | Prerendered pages equal the app's render (compared without writing the file) | scratch copy of scripts/prerender.js | OK (all 13 pages) |

## 2. Findings

**F1 (medium, bug): the free-preview reminder email still quotes the old package price ($29).**
- Reproduce: `node -e 'import("./lib/mail.js").then(({reminderEmail})=>console.log(reminderEmail({kind:"buy",name:"A B",link:"L",pricing:"P",unsubscribe:"U",preview:true}).text))'` prints "Want more shoots? Packages from $29 include it too". The HTML says "Packages with more shoots start at $29".
- Impact: lib/reminders.js still sends the "buy" reminder to legacy free-preview accounts 2–21 days after the preview finished. Previews were made until 17 Oct, so these emails go out during the sale. They state the wrong price, double the real $14.50. The sale commit 6bad4b3 made the checkout-reminder price dynamic but missed these two strings.
- Location: lib/mail.js:245 and :252.
- Fix: use `` `${FROM_PRICE}` `` (import from catalog.js) in both strings.
- Reproduced: yes.

**F2 (medium, owner decision): during the sale, "Keep them all + 2 more looks" ($14.99) costs more than Starter ($14.50), and Starter includes more.**
- What Starter gives for less: buying any package unlocks every preview (preview.js unlocksPreviews; terms §2 says the same), plus 3 full shoots and the money-back guarantee. Keep-plus is not covered by the guarantee (refunds page).
- Where it shows: a legacy preview's results page pushes "Download this photo · $8.99" and "Get all … · $14.99" (studio.js:21-35). The ready and reminder emails push $8.99/$14.99 too.
- Location: catalog.js:139 (and the $8.99 offer, now 62% of Starter).
- Options: lower or hide keep-plus during the sale, or point preview owners at Starter.
- Reproduced: yes (from reading the code and comparing prices).

**F4 (low, bug: policy accuracy): the privacy provider list is slightly wrong.**
- (a) It says Resend sends "receipts", but the app sends no receipt email. The senders are verification, reset, invite, ready, reminder, offer, contact copy and alerts; any receipt comes from Stripe.
- (b) Soro (trysoro.com) is not listed. When the feed isn't used, Soro's embed script runs in visitors' browsers on /blog (seo.js render embed, BLOG_CSP). When the feed is used, the server fetches Soro's feed and images.
- Location: views/legal.js:66-77.
- Fix: drop "receipts" (or say Stripe sends receipts), and add a Soro line ("our blog's articles; on the blog page, its script may load from trysoro.com").
- Reproduced: from reading the code (grep of every sendMail caller).

**F5 (low, bug): "disappears from the site within about 10 minutes" isn't guaranteed for the home page HTML.**
- The home page embeds approved customers' names, quotes and image URLs in its HTML (server.js withCustomers). The page is CDN-cached with `stale-while-revalidate=86400` (server.js:2322).
- After a take-down, the first visit after the page has gone more than 60 s without traffic can still get the stale HTML, with the customer's name and quote, at any later time within a day. The image itself expires after s-maxage 600.
- Fix: a shorter SWR for `/`, or purge the CDN on take-down.
- Reproduced: no (Vercel CDN behaviour; from reading the code).

**F6 (low, bug): the contact rate limit is counted before the bot check and before "contact offline".**
- Order at server.js:1791-1794: validate, then rateLimited (counts), then checkHuman, then contactEnabled.
- Impact: requests that fail Turnstile, or arrive while mail is down, use up the 5/hour allowance for that IP. A real person behind a shared IP or NAT, or one who retries a failed challenge, gets "You've sent several messages already" without having sent any.
- Fix: count only after checkHuman passes (and only for accepted sends).
- Reproduced: partly. The limit itself was hit at the 6th valid message. Turnstile is not configured locally, so the ordering is from reading the code.

**F7 (low, bug): `/pricing` and `/faq` redirects drop the query string.**
- Reproduce: `curl -sI 'localhost:3616/pricing?fbclid=abc&utm_source=x'` gives `308 Location: /#pricing`.
- Impact: ads or links pointing at /pricing lose fbclid/UTM. pixel.js reads fbclid from location.search for Meta attribution, and Vercel Analytics loses the UTM.
- Location: server.js:2331.
- Fix: `res.redirect(308, "/" + (req.url.slice(req.path.length)) + "#" + clean.slice(1))`.
- Reproduced: yes.

**F8 (low, owner decision): site search can't find topics that are only on the policy or landing pages.**
- No results for "cookies", "retry/retries", "turnaround", "cancel", "receipt", "discount/promo code". "delete account" returns only a team FAQ, not the privacy page.
- Cause: pages are indexed by title and meta description only (search.js:54); the refunds, privacy and terms bodies aren't indexed.
- Fix: index those pages' section headings and lead sentences, or add aliases (cookie→privacy, retry→refunds, delete→privacy).
- Reproduced: yes (curl /api/search).

**F9 (low, bug): the home page footer year is frozen at the prerender date.**
- The `/` page keeps the server's prerendered markup on load (hydrate; app.js:186, landing.js:62). The footer `© ${new Date().getFullYear()}` (landing.js:588) therefore shows the year prerendered.js was generated, and other pages show it to crawlers.
- Impact: on 1 Jan 2027 the home page still says © 2026 until someone re-runs `npm run prerender`.
- Fix: set the year client-side after hydrate, or render it server-side when serving.
- Reproduced: from reading the code (prerendered "/" contains the literal "© 2026").

**F10 (low, copy): the LinkedIn page says "Both versions download together".**
- That is true only for the default "Both" format. The same site (home FAQ, real-estate and résumé pages) says you can choose portrait only or square only, and then only that shape downloads (format.js formatHrefs).
- Location: linkedin.js:73.
- Fix: "Both versions are always available".
- Reproduced: from reading the code.

**F11 (low, owner decision): Terms and Privacy don't name the legal entity.**
- Emails carry "Keeper Headshots LLC, 7006 Peckham Street, Johnston, IA 50131" (mail.js:71). The Terms say the agreement is with "Keeper Headshots ('we')… based in Iowa".
- Usually the contracting party is the LLC. Consider "Keeper Headshots LLC" in Terms §1 and the Privacy intro.
- Reproduced: n/a (copy).

(F3 not used.)

Known items met: team admin "download everyone's finished headshots" (team page step 4, TEAM_FAQ, privacy team paragraph, invite email); meta descriptions ~170 chars; /examples/ images 404 locally; desktop nav has no Contact link.
