# Nightly rotation log

One line per night: date, area re-checked in full, items checked, findings.

| Date | Area | Items | Findings |
|---|---|---|---|
| 2026-11-03 | A–H (full audit) | about 715 | 74: 1 high, 13 medium, 60 low (about 40 fixed the same day; the rest are listed in coverage.md) |
| 2026-11-03 (nightly) | A. Accounts and sign-in | 110 (100 + 10 new) | No regressions; 6 earlier findings confirmed fixed; 3 new low (first-password email without Google, Google sign-up toast on a buy page, spaces in names) and a stale demo test, all fixed. Questions: no per-network limit on reset emails when Turnstile is off; "sign out of other devices" keeps those browsers as known devices; when to retire session cookies without a sid. |
