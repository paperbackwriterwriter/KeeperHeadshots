# E-security audit (auditor zz-e5, ports 3615/4615/2615)

Repo /home/user/keeperheadshots @ d1c7ac7. Method: read every route and middleware in server.js plus the libs they call (auth, teams, showcase, contact, mail, blog, seo, storage, store, shoot-jobs, billing, preview, search, og, examples, reminders, outreach, turnstile, ratelimit). Then ran a fuzz script (zz-e5-fuzz.mjs, now deleted) against a local stack with the free shoot off. It sent about 6,000 requests: 12 raw bodies (empty, `null`, `[]`, bad JSON, `__proto__` and `constructor` keys, 5,000-deep arrays, 3,000-deep objects, toString objects, duplicate keys), and every relevant field set to 12 value types (number, -1e308, bool, null, array, object, a 200 KB string, nested arrays, NUL/bidi/`<script>`, "`__proto__`", "constructor"). It also tried every route anonymously, cross-origin, and with 24 query variants on every GET. It flagged any 5xx (other than 502/503), any stack or path leak, any non-JSON /api answer, and anything slower than 3 s. **Result: no 500s, no stack leaks, no slow answers.** Cross-origin was refused on every state-changing /api route. A targeted script (zz-e5-targeted.mjs, deleted) then checked authorization, media variants, team admin access, showcase moderation, admin/cron/worker auth, paths and headers. I restarted the stack with the free shoot on, ran scripts/dev/preview-tests.js (76/76) and showcase-tests.js (40/40) against it, and wrote a preview script for derived file names. All throwaway scripts are deleted.

Legend for "who": anon = anyone; user = signed in (requireUser: signed cookie + session version + revoked sid + not-deleting); owner = the record's owner (`ownShoot`: id regex + userId); site-owner = OWNER_EMAILS with a confirmed mailbox (planFor tier owner); admin-token = `x-admin-token` header, sha256 + timingSafeEqual, at least 24 chars; cron = `Authorization: Bearer CRON_SECRET` (at least 24 chars, off when unset); HMAC = signed token.

## 1. Inventory

### Middleware (app.use) and the error handler

| # | Item (server.js line) | How checked | Result |
|---|---|---|---|
| M1 | 53 cookieParser | code read | OK |
| M2 | 57 Stripe webhook (raw body, before JSON) | code read, fuzz | OK. 404 unless STRIPE_WEBHOOK_SECRET is set; constructEvent checks the signature. It sits before the Origin check, which is correct (Stripe sends no Origin). |
| M3 | 69 express.json 4 MB | script: 5 MB body gives 413 JSON | OK. The 413 text is "That photo is too large" for every route (see E5-06). |
| M4 | 70 Vercel queue ce-type hook | code read | known (trusts ce-type) |
| M5 | 79-86 `tainted` (toString/valueOf/`__proto__`/constructor/prototype keys, depth > 6) | fuzz raw protoKey/ctorKey/toStr/deep | OK, 400 every time. Query strings aren't checked, but Express 5's simple parser only gives strings and arrays (OK). |
| M6 | 91 X-App-Build | fuzz | OK |
| M7 | 100 Origin check on /api | fuzz: Origin https://evil.example on all 34 POST/PATCH/DELETE routes | OK, 403 on all. The webhook is 404 before the check (fine). Requests without Origin pass: known. |
| M8 | 123 /api/shoots res.json wrapper (shown(), drops jobId) | code read, responses inspected | OK |
| M9 | 2222 /v/<build>/js static | script: `/v/x/js/../../server.js`, `%2e%2e`, `%2e%2e%2f` | OK (404 or 403 JSON; nothing outside public/) |
| M10 | 2231 express.static(public) | script: /.env, /package.json, /server.js, /data/.session-secret, /templates/index.html | OK, all 404 |
| M11 | 2233 /api 404, 2234 /media 404 | script | OK |
| M12 | 2343 error handler | fuzz plus code read | OK. PlanError, Stripe, 413, 400 parse, `status < 500` message, 503 storage, AIError; generic 500 text with no stack. |

### Routes (all 83 lines of routes.txt)

| # | Route (line) | Who / enforced | Validation, rate limit, caching | How checked | Result |
|---|---|---|---|---|---|
| 1 | POST /api/billing/webhook (57) | Stripe HMAC, yes | raw body | code, fuzz | OK |
| 2 | POST /api/internal/shoot-worker (115) | HMAC(SESSION_SECRET, sid:jobId:exp), compared byte-wise, exp checked | sid/jobId regex | script: forged and non-ASCII sig give 404; fuzz | OK. Replay inside 10 min only restarts an idempotent job. |
| 3 | GET /api/search (138) | anon | q string ≤ 80 chars; terms `[a-z0-9]` only, so the regex built in snippet() can't be injected; hasOwn on ALIASES; public CDN 60 s | fuzz: 5,000-char q, arrays, `q[x]` | OK |
| 4 | GET /api/version (145) | anon | no-store | fuzz | OK |
| 5 | POST /api/auth/signup (186) | anon | name 2-80, NAME_BAD; isEmail with length cap; password 8-200; Turnstile; 120/IP/h; 3/mailbox/day | fuzz plus script | **E5-02** (address syntax). Rest OK. |
| 6 | POST /api/auth/signin (226) | anon | per-IP 60/15 min, per-address 10/IP and 100 total, dummy hash for timing, password capped at 1,000 chars | fuzz, code | OK |
| 7 | GET /api/auth/google (296) | anon (reauth: user) | safeNextPath allows only `/app…` or `/join`; no-store | script: `next=//evil.com`, `/app\@evil`, `/app/../..//evil.com` | OK. The last one resolves to same-origin `//evil.com`, which the SPA answers with 404 (no off-site redirect). |
| 8 | GET /api/auth/google/callback (310) | state cookie plus nonce | next checked again; no-store | fuzz (expired path), code; google-tests exist | OK. auth_time gap: known. |
| 9 | POST /api/auth/verify (430) | HMAC token (3 days, bound to email) | regex | fuzz | OK |
| 10 | POST /api/auth/verify/code (504) | user | 6 digits; 8/h per account and per address, 30/h per IP, 20/day per mailbox, 20 lifetime | fuzz | OK |
| 11 | POST /api/auth/verify/resend (534) | user | 1/min, 5/day (atomic) | fuzz | OK |
| 12 | POST /api/auth/signout (562) | cookie | revokes sid | code | OK (SameSite=Lax plus Origin stop CSRF sign-out) |
| 13 | POST /api/auth/password/forgot (583) | anon | isEmail, Turnstile, 3/h per account, same answer whether or not the account exists | fuzz | OK |
| 14 | POST /api/auth/password/reset/check (619) | HMAC token (bound to password hash) | 60/h per IP | fuzz | OK |
| 15 | POST /api/auth/password/reset (628) | HMAC single-use token | password 8-200 | fuzz | OK (an array password is accepted as String(); harmless) |
| 16 | POST /api/auth/signout-all (683) | user | demo refused | code | OK |
| 17 | GET /api/me (690) | anon/user | private, no-store | fuzz | OK |
| 18 | GET /api/shoots (731) | user | cursor regex/length, limit 1-48 (400 otherwise) | fuzz: cursor `../`, `[a]`, limit 1e9/-5/abc | OK. No Cache-Control: **E5-05**. |
| 19 | GET /api/shoots/:id (748) | owner | id regex | script IDOR (other user gets 404), fuzz | OK. No Cache-Control: E5-05. |
| 20 | POST /api/shoots (763) | user plus plan | name: control chars stripped, ≤ 60; MAX_DRAFTS 20 | fuzz | OK |
| 21 | POST /api/shoots/:id/selfies (803) | owner, not demo | data-URL regex; sharp format allow-list; ≥ 256 px; ≤ 60 MP before decode; limitInputPixels; 150/h | script: SVG declared as PNG, 81 MP PNG, TIFF, garbage give 400; a 59 MP flat PNG is accepted in 227 ms | OK |
| 22 | DELETE /api/shoots/:id/selfies/:name (833) | owner | must match a stored selfie | script: `..%2F`, `__proto__`, `%00` give 404 | OK |
| 23 | POST /api/shoots/:id/check (874) | owner plus plan | lifetime, daily and mailbox caps, one at a time | fuzz, IDOR | OK |
| 24 | POST /api/shoots/:id/generate (988) | owner plus credit | looks through lookFor (array find, no prototype lookup), ≤ MAX_LOOKS, develop claim | fuzz (looks as object/string/nested) | OK |
| 25 | POST /api/shoots/:id/more-looks (1161) | owner plus extraLooks | as above | fuzz, IDOR | OK |
| 26 | POST /api/shoots/:id/resume (1197) | owner | MAX_RESUMES, 15 s busy | fuzz, IDOR | OK |
| 27 | POST /api/shoots/:id/reshoot (1257) | owner | held ≥ 2, once | fuzz, IDOR | OK |
| 28 | POST /api/shoots/:id/review (1309) | owner | regrade limit | fuzz, IDOR | OK |
| 29 | PATCH /api/shoots/:id (1328) | owner | name stripped, ≤ 60; pickedShotId must be a done shot | fuzz (object/array pick gives 400) | OK. No rate limit (cheap write). |
| 30 | DELETE /api/shoots/:id (1359) | owner | sample refused | IDOR script | OK |
| 31 | GET /api/team (1416) | user (own team only) | no-store | script: member sees team:null | OK |
| 32 | POST /api/team (1425) | user with confirmed mailbox | name stripped, no links, ≤ 60; looks cleaned | fuzz | OK |
| 33 | POST /api/team/invites (1434) | team admin | split on whitespace/`,`/`;`, ≤ 25; 30/h; 3 emails/address/day | fuzz plus script | **E5-02** (the per-address cap is bypassed with `name<addr>`) |
| 34 | POST /api/team/invites/:id/resend (1459) | team admin (user.teamId) | 1/min, address cap | script: non-admin gets 404; `__proto__` id gives 404 | OK |
| 35 | GET /api/team/invites/:id/link (1472) | team owner | n/a | script: non-admin gets 404 | OK. No Cache-Control: E5-05. |
| 36 | DELETE /api/team/invites/:id (1479) | team admin | release only works on status "invited" | script: non-admin gets 409 | OK |
| 37 | GET /api/join/:token (1488) | anyone with the 32-char token | token regex; no-store | fuzz | OK (shows the invitee's email to the link holder, by design) |
| 38 | POST /api/join/:token (1502) | user whose email matches the invite | n/a | script plus fuzz | OK |
| 39 | POST /api/account/delete (1643) | user plus password (10/h) or Google reauth cookie (strict, path-scoped, bound to sid) | n/a | fuzz | OK (auth_time: known) |
| 40 | POST /api/account/preferences (1681) | user, not demo | photoFormat allow-list; nameOk; refundSeen ≤ 40; 60/h | fuzz | OK |
| 41 | POST /api/billing/checkout (1718) | user | packageId through offerFor (array find); preview offers need the owner's shoot and shot; 10/h | fuzz plus script (keep on someone else's shoot gives 400) | OK |
| 42 | POST /api/billing/embed-error (1761) | user | 300 chars, CR/LF stripped, no rate limit | fuzz: NUL and U+202E reached server.log | **E5-04** |
| 43 | POST /api/billing/confirm (1769) | user (session checked against the account in billing) | `cs_\w{4,200}`; 30/h | script: long id, `../`, array give 400; another user's session gives 404 | OK |
| 44 | POST /api/billing/sync (1778) | user | 20/h | fuzz | OK |
| 45 | POST /api/contact (1786) | anon | honeypot; fields trimmed; 5/IP/h; Turnstile | script | **E5-01** (topic), E5-02 (reply address syntax, no real impact) |
| 46 | GET /media/:sid/:name (1904) | owner, or team admin for an exact done-shot file | sid/name regex; derived-name rules; selfie squares/sizes refused; dropSelfies hidden; preview watermark; private caching | see M-rows below | OK |
| 47 | GET /examples/:id.(jpg\|webp) (1989) | anon | id regex; canonical-query 301; w allow-list; v `\w{1,12}` | script | OK |
| 48 | GET /api/showcase (2012) | anon | approved only, public 60 s | script | OK |
| 49 | GET /showcase/:id.webp (2016) | approved: anon; pending: site-owner or author | w allow-list; pending is private, no-store | script: anon and other user get 404, site-owner and author get 200 | OK |
| 50 | GET /api/showcase/mine (2029) | user | no-store | fuzz | OK |
| 51 | POST /api/showcase (2033) | owner of shoot and shot; preview must be kept | consent === true; name/role/quote cleaned, no links, length caps; 10/h; 200 pending at most | script: another user's shoot gives 404; `$\`` and quotes escaped on the home page | OK |
| 52 | DELETE /api/showcase/mine (2060) | user | n/a | script: the public image is 404 afterwards | OK |
| 53 | GET /api/owner/showcase (2065) | site-owner | no-store | script: user 404, anon 401 | OK |
| 54 | POST /api/owner/showcase/:id (2072) | site-owner | status allow-list, validId, missing id gives 404 (updateJSON does no write on a missing key) | script | OK |
| 55 | GET /og/:slug.png (2082) | anon | slug `[a-z-]+`, hasOwn | script: constructor gives 404 | OK |
| 56 | GET /api/owner/funnel (2091) | site-owner | days allow-list | script | OK |
| 57 | GET /api/owner/shoots (2099) | site-owner | days allow-list; masked emails | script; preview-tests | OK |
| 58 | POST /api/owner/offer (2108) | site-owner | CODE regex, checked in Stripe first, send only when send === true | script plus preview-tests | OK |
| 59 | GET /api/admin/examples (2128) | admin-token (header only) | n/a | script: none/wrong/query token give 404, right gives 200 | OK. No Cache-Control: E5-05. |
| 60 | GET /api/admin/examples-set/:set (2129) | admin-token | SETS.includes | script | OK |
| 61 | GET /api/admin/examples-sheet (2132) | admin-token | w/cols not bounded below or above | script (no 500 on the fresh stack) | OK, minor (admin only) |
| 62 | GET /api/admin/examples/:id/square (2137) | admin-token | `EXAMPLE_JOBS[id]` | script | **E5-03** |
| 63 | GET /api/admin/examples/:id (2143) | admin-token | `EXAMPLE_JOBS[id]` | script: `constructor` generated an image | **E5-03** |
| 64 | GET /api/cron/cleanup (2164) | cron | n/a | script: 404 without a secret | OK |
| 65 | POST /api/unsubscribe (2181) | HMAC token (192-bit, never expires) | regex, timingSafeEqual; urlencoded 2 KB | script: bad tokens give 400 | OK |
| 66 | GET /api/cron/shoots (2196) | cron | n/a | script | OK |
| 67 | GET /api/cron/backup (2202) | cron | n/a | script | OK |
| 68 | GET /api/cron/blog (2210) | cron | n/a | script | OK |
| 69 | GET /blog/img/:name (2271) | anon | IMG_NAME `[a-f0-9]{24}.(jpg\|webp)`; immutable | script: `..%2F` gives 404 | OK |
| 70 | GET /blog/sitemap.xml (2278) | anon | slugs validated at sync | script | OK |
| 71 | GET /.* SPA (2323) | anon | `//` and `\` give 404; trailing-slash 301 stays on the path; /pricing 308; CSP/BLOG_CSP; noindex off canonical hosts | script: `//evil.com`, `/\evil.com`, `/%5C…`, `/%2F%2F…`, `/app//`, `/blog/<script>`, `/blog?post=__proto__` | OK |
| 72-83 | The 12 `use` lines in routes.txt (53, 69, 70, 86, 91, 100, 123, 2222, 2231, 2233, 2234, 2343) | see M1-M12 | | | see above |

### Cross-cutting items

| Item | How checked | Result |
|---|---|---|
| /media owner: plain, ?square, ?size=linkedin/banner/signature, ?download, every derived name direct | script | OK. Originals are private 1 year (clean previews 1 h); derived files are private, no-cache; filenames are `[\w-]` only. |
| /media with ?square on a derived name | script | OK, 404 |
| /media for selfies: plain 200; ?square and ?size give 404 | script | OK |
| /media as another user, as the site-owner, anonymously (JSON 401; navigation goes to /signin?next=/app/shoot/<sid>) | script | OK |
| /media with `?size=__proto__`, constructor, toString, hasOwnProperty, LINKEDIN | script | OK, 404 (SIZES lookup hits the prototype, but makeSize returns null) |
| /media path tricks (`..%2F`, .JPG, .jpg.png, .svg, missing name) | script | OK, 404 |
| /media team admin: member headshot plain/square/sizes/download 200; selfie 404; derived names direct 404; member's downloadedAt not set by the admin | script | OK (admin can open every done shot, not just the pick: known item) |
| /media legacy preview: watermark, ≤ 1024 px, no-cache, preview filename; squares/sizes/derived names/widened square watermarked; selfies clean; kept shot clean in every size; refund relocks | preview-tests 76/76 plus my script (kept shot and other shot × 8 variants) | OK |
| Showcase moderation and refund takedown | showcase-tests 40/40 plus script | OK |
| CSP: no unsafe-inline scripts, object-src none, frame-ancestors none, base-uri self; Soro only on /blog | script plus code | OK (style unsafe-inline: deliberate) |
| Other security headers (nosniff, XFO, Referrer-Policy, Permissions-Policy, HSTS) | vercel.json read | OK on Vercel; local Express sends only CSP. x-powered-by is off. |
| Cookie flags: ahg_session (HttpOnly, Lax, Secure in prod, 30 days); kh_device and kh_origin (HttpOnly, Lax, path /api/auth); kh_reauth (Strict, path /api/account/delete, 5 min); kh_google (HttpOnly, Lax, path /api/auth/google) | script Set-Cookie plus code | OK |
| Open redirects: Google next, SPA trailing slash, /examples, /blog?post, media sign-in redirect | script | OK |
| Email header/body injection: names have control chars and bidi removed; HTML escaped; subjects have no CR/LF; addr() strips `"\<>` from display names | code plus mock mail | OK. Recipient-address syntax: E5-02. |
| Server-rendered HTML escaping (seo.js esc/ld, customers.js esc, blog cleanHtml) | script: home showcase quote; unit run of cleanHtml with javascript:, entity-split javascript:, onerror, svg script, data:, math xlink, style, onclick | OK, all stripped |
| SSRF in blog image fetch | code (https only, IP-literal check, lookup hook against DNS rebinding, redirect re-check, 15 MB, 20 s) plus a unit run of privateAddress on 24 addresses | OK (`::ffff:0:a.b.c.d`, the IPv4-translated form, isn't treated as private; Linux doesn't route it to v4, so it doesn't count). blog-tests.js not run (fixed ports 3130/4030). |
| Path traversal in storage keys | code: fs `abs()` root check; every key built from a regex-checked id | OK |
| JSON size and depth limits, large lists (invite emails ≤ 25, looks ≤ MAX_LOOKS, cursor ≤ 300) | fuzz | OK |
| Expensive images (decompression bomb, 60 MP cap, limitInputPixels, blog 60 MP) | script | OK |
| ReDoS: isEmail length-capped first; contact/teams email caps 200; search terms alnum; NAME_CHARS, ADDRESS_LIKE | code plus fuzz (200 KB strings returned quickly) | OK |
| Prototype keys in lookups: TOPICS, EXAMPLE_JOBS, SIZES, ALIASES (hasOwn), OG (hasOwn), team.invites[id], lookFor/offerFor (find) | script | E5-01, E5-03; the rest OK |
| GETs with side effects (advance, joinedTeam backfill, invite expiry, downloadedAt) | code | OK (none can be triggered across sites with a harmful effect) |
| Login CSRF / CSRF on POST | Origin check plus SameSite=Lax plus Google state cookie | OK (requests with no Origin: known) |

Items checked: 12 middleware + 71 route handlers (all 83 lines) + 24 cross-cutting = **107**.

### Added at the nightly re-check of 7 Nov 2026

All 107 items above were re-checked on 7 Nov (still 83 route lines; E5-01/02/03/05/06 confirmed fixed, E5-04 fixed that night). New items:

| Id | Item | How | Result (7 Nov) |
|---|---|---|---|
| E-N1 | Hourly checkout limit under concurrency: 45 checkouts at once from one account | script | Was 45 of 45 accepted (check and record were separate since 5 Nov); fixed: claimed in one save, exactly 30 pass |
| E-N2 | /api default caching: every /api GET is `private, no-store` except /api/search, /api/showcase and /api/version | curl over all GETs | OK |
| E-N3 | GET /api/join/:token tells only the signed-in viewer about themselves (sameInbox, confirmNeeded); anonymous sees sameInbox:false | script | OK |
| E-N4 | Invitation inbox matching: Gmail dots/+tags only, and only for an account that confirmed its address itself; 403 invite_confirm_email / invite_other_email | script + team-tests | OK |
| E-N5 | One strict address check (isEmailAddress) for signup, invite, contact; the looser lookup check only for sign-in and reset, mail never to the typed address | fuzz + code | OK |
| E-N6 | Invitation caps: 25 per request, 100 live, 300 in all, checked inside the save; two requests at 99 | team-tests | OK |
| E-N7 | Admin view of a team reshoot: only when both shoots point at each other, same member, done shots only; selfies and other admins 404 | reshoot-tests + probes | OK |
| E-N8 | Meta: owner and demo accounts get no eventId and send no InitiateCheckout, Purchase or CompleteRegistration; `charged` only for the account's own paid session | /mock-meta | OK |
| E-N9 | Reset emails: at most 30 an hour per network, counted before the bot check | script | OK |
| E-N10 | Resend and the invitation-link GET expire an invitation past 90 days (owner only) | code + team-tests | OK |
| E-N11 | /api/contact: order of the bot check and the 5-per-network limit | code | Question: the bot check runs first, so bad tokens each cost a Cloudflare call (not testable locally) |
| E-N12 | /api/billing/embed-error: at most 20 logged an hour per account; all control and invisible characters stripped | script | Fixed 7 Nov (E5-04) |

## 2. Findings

### E5-01: contact form topic accepts inherited property names (low, bug)
- Repro: `POST /api/contact {"name":"Topic Test","email":"t@x.com","topic":"constructor","message":"Hello there, this is a test."}` returns 200. The email to the team arrives with the subject `[Contact] function Object() { [native code] } — Topic Test`. With `__proto__` the subject is `[object Object]`; toString and hasOwnProperty are similar. The stored record gets the same topicLabel.
- Impact: garbled subject and topic label in the team inbox and storage. Nothing worse.
- lib/contact.js:30 `topic: TOPICS[body?.topic] ? body.topic : "general"`.
- Fix: `topic: Object.hasOwn(TOPICS, body?.topic) ? body.topic : "general"`.
- Reproduced: yes (local stack, mock mail).

### E5-02: email validation accepts display-name and list syntax, which bypasses per-address caps (low, bug)
- Repro: as a confirmed team admin with 1 credit, invite `n0<victim@evil.com>`, cancel, invite `n1<victim@evil.com>`, and so on. Five invites in a row all came back `sent:true`, and the mock (which parses `Name <addr>` the way Resend does) delivered 5 emails to victim@evil.com. With a plain address the cap is 3 a day (INVITE_EMAILS_PER_DAY). Signup also accepts `victim@evil.com,x`, `x<victim@evil.com>`, `a@b.c>` and `victim@evil.com;x` (201), each as a distinct canonical mailbox, so SIGNUP_MAX_PER_MAILBOX (3 a day) and the per-mailbox free-check and free-shoot keys don't apply.
- Recipient handling: emails sent with a string recipient (`to: u.email`/`p.email`/`inv.email`: ready, reminder, offer and invite emails) are split by nodemailer's parser into the real mailbox. `victim@evil.com,x` became victim@evil.com plus `x`, and `x<victim@evil.com>` became victim@evil.com. Resend's `to` accepts `Name <addr>`. The admin-chosen part shows as the display name in the victim's To: header, and ADDRESS_LIKE isn't applied to it.
- Impact: the anti-flooding caps on invite and signup emails can be bypassed, with mail going out from our DMARC p=reject domain. Bounded by the 30 invites an hour per admin (each needs a credit, returned on cancel) and by Turnstile plus 120 signups an hour per IP. Contact-form Reply-To can also hold several addresses, but the sender controls that anyway.
- Code: server.js:149 isEmail, lib/teams.js:62 isEmail, lib/contact.js:35.
- Fix: one shared strict check that refuses `<>,;:"()[]\` and control characters in both parts, for example `/^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/` (keep the length check first).
- Reproduced: yes for the invite cap bypass and for signup acceptance, against the mock. Actual Resend delivery for the object-form (signup) recipient was not verified.

### E5-03: admin example routes accept inherited property names (low, bug)
- Repro: `GET /api/admin/examples/constructor` with a valid `x-admin-token` returned `{"ok":true,"id":"constructor","bytes":24289}`. It ran an image generation (a paid AI call in production) and stored `examples/constructor.jpg`. `/api/admin/examples/__proto__/square` gave 409 "Generate __proto__ first."
- Impact: admin only. A typo-class mistake spends an AI call and leaves a junk example file.
- Code: server.js:2138 and 2144 (`EXAMPLE_JOBS[req.params.id]`); lib/examples.js:203 (sheet).
- Fix: `Object.hasOwn(EXAMPLE_JOBS, id)`.
- Reproduced: yes.

### E5-04: /api/billing/embed-error writes client text to logs almost unfiltered, with no rate limit (low, bug; fixed 7 Nov)
- Repro: `POST /api/billing/embed-error {"message":"‮\u0000<script>alert(1)</script>"}` as any user. server.log then holds the NUL byte and the bidi override (grep treats the file as binary). Only CR/LF are removed, so ANSI escapes would pass too. There's no overLimit, so one account can write about 300 bytes per request without limit.
- Impact: log forging and terminal-escape content in Vercel or local log viewers; log flooding.
- Code: server.js:1762.
- Fix: `.replace(/[\p{Cc}\p{Cf}]/gu, " ")` and `overLimit("embederr", req.user.id, 20)`.
- Reproduced: yes.

### E5-05: private JSON GETs carry no Cache-Control (low, hardening, owner decision)
- Repro: `GET /api/shoots`, `GET /api/shoots/:id`, `GET /api/team/invites/:id/link` and `GET /api/admin/examples` answer with only a weak ETag and no Cache-Control. Compare /api/me (private, no-store), /api/team and /api/showcase/mine (no-store).
- Impact: small today. The Vercel CDN doesn't cache without s-maxage, and browsers don't cache heuristically without Last-Modified. But a shoot (with signed photo names and the invite link token) depends on those defaults, against the stated "never a shared cache" rule.
- Code: server.js:91-94 (the /api middleware is the natural place).
- Fix: `res.set("Cache-Control", "private, no-store")` by default in the /api middleware; routes that are meant to be public (/api/search, /api/showcase) already override it.
- Reproduced: yes.

### E5-06: every oversized JSON body is answered "That photo is too large" (low, bug, copy)
- Repro: a 5 MB contact-form POST gives 413 `{"error":"That photo is too large. Try a smaller one."}`.
- Impact: misleading message outside selfie upload. Only scripted clients can hit 4 MB on other forms.
- Code: server.js:2350.
- Fix: use that wording only for /selfies, and "That request is too large." elsewhere.
- Reproduced: yes.

Known items met: requests without Origin pass (M7); queue ce-type (M4); appOrigin uses Host (links in local emails); Google auth_time (routes 8 and 39); team admin can download every done shot, not just the pick (media team rows).
