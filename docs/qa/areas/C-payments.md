# C-payments audit (prefix zz-c3, ports 3613/4613/2613), repo d1c7ac7

Method: a stack e2e script (mock Stripe/Meta, 65 checks), an in-process webhook script with a stub Stripe (new prices, every refund/dispute path, 113 refund scenarios), the existing suites (billing-dispute 13/13, billing-deleted 3/3, billing-team-refund 11/11, preview-tests 76/76 against my stack with the free shoot on), and two Playwright runs of the buy page (hosted fallback, plus embedded with Stripe.js stubbed). All zz-c3 scripts are deleted.

## 1. Inventory

| # | Item | How checked | Result |
|---|------|-------------|--------|
| 1 | POST /checkout starter: amount 1450, 3 shoots, value 14.5, success/cancel URL /app | e2e | OK |
| 2 | checkout professional 1950/6 | e2e | OK |
| 3 | checkout executive 2450/12 | e2e | OK |
| 4 | checkout embedded:true gives clientSecret, ui_mode embedded_page, return_url | e2e | OK |
| 5 | embedded:true with no publishable key falls back to hosted | code read (server.js:1731) | OK |
| 6 | returnTo=team goes to /app/team; another value goes to /app | e2e | OK |
| 7 | unknown, empty, `__proto__` or `toString` package gives 400 | e2e | OK |
| 8 | keep/keep-plus with no shoot or another person's shoot gives 400 | e2e + preview-tests | OK |
| 9 | keep-plus checkout at 14.99 returns to the shoot; keep at 8.99 needs a shot | preview-tests | OK |
| 10 | offer for a shoot that is already unlocked (not_preview), not done, or already kept | preview-tests + code read | OK |
| 11 | offer session expires_at 1h | code read billing.js:119 | OK |
| 12 | 10-starts-an-hour checkout limit | e2e | **C3-4** |
| 13 | lastCheckout recorded for packages only | code read | OK |
| 14 | InitiateCheckout Meta value = sale price | e2e (mock-meta) | OK |
| 15 | demo account gets 403 at checkout/confirm; buy page shows "create account" | code read (requireBilling) + buy.js | OK |
| 16 | billing off gives 503 billing_not_configured; wrong-mode key turns billing off | code read billing.js:34-46 | OK |
| 17 | POST /embed-error: logs a 300-character string on one line; object message | e2e | OK |
| 18 | /confirm: invalid id, numeric id → 400 | e2e | OK |
| 19 | /confirm: another account's session → 403 | e2e | OK |
| 20 | /confirm: unpaid session → paid:false, nothing granted | e2e | OK |
| 21 | /confirm: unknown session → 404 clean | e2e | OK |
| 22 | /confirm twice → added 0, appliedAt, no double credit | e2e | OK |
| 23 | /confirm 30/min limit | code read | OK |
| 24 | /sync after confirm: no double grant; picks up a missed grant | e2e + preview-tests | OK |
| 25 | /sync picks up refunds (mock-refund) incl. partial / two packages | preview-tests 4b/4c/4e | OK |
| 26 | sync lease/automatic throttle/history paging/account deleting | code read billing.js:388-438 | OK |
| 27 | webhook bad signature → throws → 400 | unit | OK |
| 28 | webhook 404 without STRIPE_WEBHOOK_SECRET | code read server.js:57 | OK |
| 29 | checkout.session.completed paid → grant | unit | OK |
| 30 | completed unpaid → nothing; async_payment_succeeded → grant; async_payment_failed ignored | unit | OK |
| 31 | completed retried/duplicated → once | unit + billing-deleted | OK |
| 32 | charge.refunded partial/full, repeated | unit | OK |
| 33 | out of order: charge.refunded before the payment is recorded | unit | **C3-3** |
| 34 | dispute created (inquiry warning_*) takes nothing | unit + dispute suite | OK |
| 35 | dispute created (chargeback) + funds_withdrawn: taken once, booked once | unit | OK |
| 36 | dispute closed lost: nothing more | unit | OK |
| 37 | dispute closed won + funds_reinstated: given back once, funnel −amount once | unit | OK |
| 38 | late funds_withdrawn after a win takes nothing | unit | OK |
| 39 | dispute after partial refund; won after partial | dispute suite | OK |
| 40 | disputes not shown as refund notice | unit | OK |
| 41 | payment for a deleted account: recorded, orphaned, flagged, webhook retried OK | billing-deleted | OK |
| 42 | payment for a deleted shoot (offer): recorded, flagged | billing-deleted | OK |
| 43 | redundant offer flags (already unlocked / already kept) | code read + preview-tests | OK (plus a known item) |
| 44 | refund for a deleted account → unpaySeatsOfGoneOwner | team-refund suite | OK |
| 45 | lib/plan.js tiers: demo, owner (needs a confirmed mailbox), paid, trial, none (started / teamMember) | code read + e2e (unconfirmed owner email = paid, counted in the funnel) + unit (owner not counted) | OK |
| 46 | creditLots / creditSource: package lots, oldest spent first | unit + dispute/team suites | **C3-2** |
| 47 | creditsOwed settled by a new purchase | unit | OK (the toast miscounts: **C3-5**) |
| 48 | creditsOwed from refunds reaching seats; settleDebt withdraws invites; invites blocked while owing | team-refund suite | OK |
| 49 | undoDevelopCharge / releaseDeveloping (failed develop, shoot delete, cleanup, account delete) incl. "short" refund case | code read server.js:1121-1131,1369-1371,1600-1606; cleanup.js:110; teams.js:31-48 | OK |
| 50 | Pro-rata to the cent, Starter $14.50 (483/966/1450 thresholds) | unit (every k, four rounding methods) | OK with standard rounding; **C3-1** |
| 51 | Pro-rata Professional $19.50 (325 steps) | unit | OK (all methods) |
| 52 | Pro-rata Executive $24.50 (204/408/612/816/1020/1225/1429/1633/1837/2041/2245/2450) | unit | OK with standard rounding; **C3-1** |
| 53 | one-share boundary (floor −1c removes 0, floor removes 1) | unit | OK |
| 54 | full refund revokes purchase; partial keeps it | unit | OK |
| 55 | refunded keep re-locks the headshot; keep-plus extra looks removed; showcase down | preview-tests 4b + dispute suite | OK |
| 56 | looksAsShoot refund/dispute/win | dispute suite | OK (but see C3-2) |
| 57 | Promo HALF starter/executive: amount 725/1225, discount recorded, revenue & Meta value net | e2e | OK |
| 58 | Promo FREE (no_payment_required): granted, no revenue, no Purchase event, "Order complete" toast | e2e | OK |
| 59 | promotionCode() lookup | code read (used by lib/outreach.js) | OK |
| 60 | stats: purchase revenue cents, buyer once, owner/demo excluded | e2e + unit | OK |
| 61 | stats: refunds counted once per amount, refunded order once | unit | OK |
| 62 | stats: reverseRefund on a won dispute, keeps the ordinary refund | unit + dispute suite | OK |
| 63 | funnel page money display | script (same formatter) | **C3-6** |
| 64 | Meta Purchase value = amount_total/100, USD, event id purchase_<cs>, browser dedupe id | e2e | OK |
| 65 | buy.js: headline per package ($14.50/$19.50/$24.50), unknown package, offer without shoot | browser | OK |
| 66 | buy.js embedded summary: "Was $29/$39/$49, now …", features, guarantee note, other-package links | browser (Stripe.js stubbed) | OK |
| 67 | buy.js Stripe.js fails → embed-error → hosted redirect | browser | OK |
| 68 | return: success toast "Payment received: 12 shoots added", cancelled toast, reopen within 2 min | browser | OK |
| 69 | views/price.js wasPrice (only when listPrice > price; offers none) | browser + code read | OK |
| 70 | dashboard plan banner "6 shoots available"; "Packages start at $14.50 for 3 shoots" | browser + code read | OK |
| 71 | account "Shoots left", unused-shoot delete warning | browser + code read | OK |
| 72 | refund notice (creditsTaken + looksShootTaken, disputes excluded, seen marker) | unit + code read auth.js:292-299 | OK |
| 73 | /refunds page: example Pro $19.50, $3.25/shoot, refund $16.25 → leaves 0 shoots; full $19.50 revokes | unit (k=1 → 1625 → 0 left) | OK |
| 74 | /refunds "any shoots left from the refunded package are removed" | unit | OK (with standard rounding, C3-1) |
| 75 | /refunds "shared headshot comes down when fully refunded" (incl. team admin) | preview-tests 4b + code read | OK |
| 76 | /refunds offers $8.99/$14.99 not covered (manual policy) | page read | OK |
| 77 | /terms: $8.99 / $14.99; keep-all or any package unlocks the preview | page read vs preview.js unlocksPreviews | OK |
| 78 | /terms "unused shoots don't expire" (no expiry code) | grep | OK |
| 79 | prerendered /refunds and /terms prices match the views | script | OK |
| 80 | billing.js comment uses the old $29 example | read | **C3-7** |
| 81 | Known: keep-plus for a deleted shoot counts in unlocksPreviews; transient looksAsShoot read; stale develop races | — | known |
| 82 | Preview offers at $4.50 / $7.50: amount 450/750, value 4.5/7.5, metadata shoots "0", returns to the shoot | script | OK (5 Nov) |
| 83 | Offer buy page: crossed-out price, screen readers hear "Was $8.99, now $4.50" / "Was $14.99, now $7.50"; links to other offers and packages at sale prices | Playwright | OK |
| 84 | Offer refunds to the cent (450, 750, HALF 225/375): 1c short keeps it; full refund revokes (kept shot, extra looks, previews locked again); funnel refund equals amount | webhook script + sync | OK |
| 85 | Offer revenue and Meta: revenue +450/+750; Purchase 7.5; InitiateCheckout 4.5/7.5 | script | OK |
| 86 | Dispute and team-refund suites re-run at sale amounts (1450/750/483/484/967) | suites | OK |
| 87 | Checkout limit: exactly 30 starts an hour, then 429 | hardening | OK |
| 88 | Checkout limit: refused or failed requests don't count | hardening | fixed 5 Nov (they did, C3-4) |
| 89 | Funnel totals for a net-negative refund period (a won dispute) | hardening (static) | fixed 5 Nov (showed "−$-24.50", C3-6) |
| 90 | Signed-out checkout 401; demo sync does nothing | script | OK |
| 91 | Owner purchases are sent to Meta (Purchase/InitiateCheckout) though left out of the funnel | script | owner question |
| 92 | packageId sent as a non-string (["starter"]) is turned into text and accepted | script | harmless, noted |
| 93 | Hosted checkout end to end in a browser: buy page, Stripe, /app toast "6 shoots added", credits 6 | Playwright | OK |
| 94 | A webhook request without a valid Stripe signature (a bot) is logged as a warning, not an error, so it doesn't use up the day's alert emails | billing-dispute-tests | fixed 5 Nov (a live probe at 02:29 sent an alert) |

Items checked on 5 Nov (rotation): 94 (81 + 13 new).

## 2. Findings

**C3-1 (low, owner decision): refunds worked out with the per-shoot price rounded UP leave one shoot on the account.** Reproduced: yes (unit). Executive with k kept shoots, refund 2450 − k×205 (k = 2..11), e.g. k=5 → $14.25 < threshold 1429: the account keeps 1 shoot and the notice says 6 removed, not 7. Starter k=2 refunded at 1450 − 2×484 = $4.82 < 483: nothing is removed. Standard rounding (price − round(k×price/n), or k×$4.83 / k×$2.04) is always fine. The shortfall is the customer's gain of one shoot. Lowest refund that clears all remaining shoots: Starter 14.50 / 9.66 / 4.83; Pro 19.50 / 16.25 / 13 / 9.75 / 6.50 / 3.25; Executive 24.50 / 22.45 / 20.41 / 18.37 / 16.33 / 14.29 / 12.25 / 10.20 / 8.16 / 6.12 / 4.08 / 2.04 (for k = 0, 1, 2, …). Fix: none needed in the code. Either keep this table for whoever issues refunds, or round the threshold at billing.js:261 (`Math.round` instead of `Math.floor`, or allow a tolerance of k cents).

**C3-2 (low, bug): creditLots counts a credit that is not a package's (keep-plus looks that became a shoot, lib/store.js:369) as a package's.** Reproduced: yes (unit). Starter bought, all 3 used, then keep-plus ($14.99) for a preview whose selfies are gone gives 1 credit with looksAsShoot. (a) A Starter chargeback takes that credit (creditsTaken 1, credits 0), although that package's shoots were all spent. (b) Alternatively, a full keep-plus refund leaves the credit (`unassigned` = 0 at billing.js:331, looksShootTaken false), so the customer keeps a shoot they were refunded for. File: lib/plan.js:47-62, billing.js:303,331. Fix: in creditLots, add each unrefunded `looksAsShoot` purchase as its own lot of size 1 (at = its purchase time), so the credit is attributed to the purchase that made it. Legacy-preview accounts only.

**C3-3 (low, bug): a refund (charge.refunded) processed before the payment record exists is dropped.** Reproduced: yes (unit). charge.refunded, then checkout.session.completed gives 3 credits after a full refund. It is repaired only by the next /sync, which runs from the dashboard; /confirm does not reconcile, and /app/new can be reached directly. This happens only if the completed webhook and the confirm both failed before the refund. File: billing.js:245-246. Fix: in fulfil, after granting, run `reconcileRefund(session)` when `session.payment_intent?.latest_charge?.amount_refunded > 0`, or have the webhook's completed branch retrieve the session with `expand: payment_intent.latest_charge` and reconcile.

**C3-4 (low, bug): the checkout limit (10 an hour) counts every request, including rejected ones and every buy-page view.** Reproduced: yes (e2e). After 4 bad-package 400s, 2 keep 400s and 4 real starts, keep-plus got 429. Each /app/buy/* view makes a session, the "Want a different package?" links make another each, and an embedded failure makes 2. A buyer who compares packages a few times is locked out for an hour ("You've started several checkouts…"). File: server.js:1720-1729. Fix: check the package and offer before counting, and record the start only after `createCheckout` succeeds. Possibly also raise the limit to about 20.

**C3-5 (low, bug): the success toast overstates shoots when the purchase settles a refund debt (creditsOwed).** Reproduced: partly. The unit test shows owed 2 + Starter → +1 credit. That confirm returns `added: 3` and the toast says "3 shoots added" is from reading the code (billing.js:211 returns `shoots`, not `shoots - settle`). Fix: return `shoots - settle` from fulfil, or mention "2 settled your team's unpaid seats".

**C3-6 (low, bug): the owner funnel shows "−$-14.50" on a day when a chargeback was won.** Reproduced: yes (the page's formatter). reverseRefund books `refunds: -amount` on the day it is won. funnel.js:92 prints `−${money(d.refunds)}` → "−$-14.50", and the totals show the same if the reversal is the only refund in the period. Fix: `d.refunds > 0 ? −money : d.refunds < 0 ? "+"+money(-d.refunds) + " (dispute won)" : ""`.

**C3-7 (low, bug, doc only): billing.js:257-258 comment still uses the old $29 example** ($9.66 / $19.33 / $9.19). At $14.50 the steps are $4.83 / $9.66 / $14.50. Fix: update the comment. Reproduced: n/a.

Counts: 81 items checked; 0 high, 0 medium, 7 low (1 owner decision, 6 bugs); 1 known item met.
