# Session log — reg line start anchor

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/reg-line-start-anchor`

## Summary

One-line fix: the Registrations (green) line on the Daily Trend chart was starting from the first Mailchimp snapshot day instead of the chart window start. Changed `lastRegs` seed from `null` to `0` in the `mailchimpDays` carry-forward helper so the line draws flat at 0 from window start and jumps to the real value when the first snapshot arrives.

## Scope / files

- `components/dashboard/events/event-trend-chart.tsx` — `mailchimpDays` useMemo: seed `lastRegs = 0` (was `null`); remove now-redundant `lastRegs != null` guard in CPR condition.

## Validation

- [x] `npm run build` — passes
- [x] `npx eslint` on changed file — 0 errors (2 pre-existing warnings in unrelated code)

## Notes

- CPR line is unaffected: `lastRegs > 0` guard stays in place, so CPR remains null until the first non-zero snapshot arrives, preventing a misleading early CPR point.
- The pill summary (`mailchimpSummary`) still displays the latest carry-forward value (the most recent real snapshot count) — no regression there.
