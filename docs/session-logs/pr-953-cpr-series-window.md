# Session log — CPR series window

## PR

- **Number:** 953
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/953
- **Branch:** `cursor/cpr-series-window`

## Summary

The Daily Trend CPR line used all-time spend ÷ all cumulative
registrations, so it kept climbing after signups ended and disagreed
with the card (£0.94 vs £0.91). The series now uses the card's spend
window: a value on each day from first spend through general sale,
null after it. The last plotted point equals `model.cpr.cpr`. The
pill names the span (`CPR · to 9 Sept`).

## Scope / files

- `lib/dashboard/signup-phase-cpr.ts` — shared `cprSignupFromDay` +
  `signupPhaseSpendThrough`
- `lib/dashboard/registrations-card-model.ts` — imports the from-day
- `lib/dashboard/trend-cpr.ts` — chart series
- `components/dashboard/events/event-trend-chart.tsx` — plot + pill
- `lib/dashboard/__tests__/trend-cpr.test.ts`
- `lib/dashboard/trend-chart-data.ts` — export `isoWeekStart` so
  weekly CPR uses the same Monday the chart plots

## Round 2

Weekly buckets were dividing a week of spend (including ticket
days) by signups through the Monday. Each bucket is now sliced to
the in-window days — `2026-09-07` is cumulative 26 Aug – 9 Sept
spend (£1,439.37) over 26 Aug – 9 Sept signups (1,589), not a
7–9 Sept per-bucket ratio (that would not equal the card) — so the
last weekly point equals the card. Brand `cpt` was named and left
alone. The Mailchimp weekly path was still mixed (named only).

## Round 3

Weekly registrations was summing Mondays only (D.O.D 394 vs 1,839).
The series is now built on the daily spine and sampled at each
bucket's last in-bucket day. Weekly Mailchimp CPR is null with a
caption rather than a mixed-window number. The `1714aba` commit
message still says "7–9 Sept spend against 7–9 Sept signups"; that
commit is already on the remote, so the wording lives here and in
the PR body instead.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm test` — 5972 pass / 0 fail / 4 skipped
- [x] `npm run build` — compiled, typecheck finished, 193 static pages
- [ ] Check-run conclusions on the final head — PR thread, not a commit

## Notes

`computeRegistrationsData` untouched. `evaluate.ts` / `apply.ts` /
`gates.ts` / `components/plan/**` off the file list. No migration.
`signup-window.ts` and `registrations-card-model.ts` frozen this
round. `trend-registrations.ts` is in scope.
