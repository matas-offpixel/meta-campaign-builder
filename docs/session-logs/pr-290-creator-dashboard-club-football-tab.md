# Session log

## PR

- **Number:** 290
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/290
- **Branch:** `creator/dashboard-club-football-tab`

## Summary

Separates 4thefans dashboard region tabs by event_code: Club Football (4TF*/LEEDS*) and Off/Pixel Own (OP-*) as peers to the three geographic tabs. Funnel pacing benchmarks use LEEDS26-FACUP for the club tab when sold-out criteria match, and client-wide WC26 sold-out events for geographic tabs.

## Scope / files

- `lib/dashboard/client-regions.ts` — `categorizeEvent`, `assignEventToDashboardTab`, extended tab keys and labels
- `lib/reporting/funnel-pacing.ts` — tab-scoped filters + benchmark resolution
- `lib/reporting/creative-patterns-cross-event.ts` — tab-scoped event filter + label fallbacks

## Validation

- [x] `npx tsc --noEmit` (repo has pre-existing errors in unrelated `lib/meta` / `lib/audiences` tests; changed files lint clean)
- [ ] Manual: `/clients/{4thefans}/dashboard` — Club Football tab lists club codes only; WC regions exclude club/OP

## Notes

- Geographic tabs still bucket non-WC26 “other” codes by venue when present; club/OP never appear there.
