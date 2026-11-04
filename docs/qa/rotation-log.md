# Nightly rotation log

One line per night: date, area re-checked in full, items checked, findings.

| Date | Area | Items | Findings |
|---|---|---|---|
| 2026-11-03 | A–H (full audit) | about 715 | 74: 1 high, 13 medium, 60 low (about 40 fixed the same day; the rest are listed in coverage.md) |
| 2026-11-03 (nightly) | A. Accounts and sign-in | 110 (100 + 10 new) | No regressions; 6 earlier findings confirmed fixed; 3 new low (first-password email without Google, Google sign-up toast on a buy page, spaces in names) and a stale demo test, all fixed. Questions: no per-network limit on reset emails when Turnstile is off; "sign out of other devices" keeps those browsers as known devices; when to retire session cookies without a sid. |
| 2026-11-04 (nightly) | B. Shoots | 93 (74 + 19 new) | No regressions; B2-1 to B2-5 confirmed fixed. New: a team reshoot's 4th photo check said "start your first shoot" (fixed); deleting a team shoot's failed original hides the reshoot's headshot from the admin (B-R1, owner question). Change review: a headshot shared from a free reshoot stayed up after a full refund (fixed), a stale sitemap date and old prices in two notes (fixed). Questions: deleting the original before the reshoot develops; 3 free checks on a team reshoot; the square attaching after "done"; extra looks resetting retries. |
