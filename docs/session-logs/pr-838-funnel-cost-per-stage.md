# Session log

## PR

- **Number:** 838
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/838
- **Branch:** `cursor/funnel-cost-per-stage`

## Summary

Phase A.2: cost-per-stage per channel on the event report, derived from the #837 helper. CPM / cost-per-reach / CPC per platform, blended cost per signup and ticket with provenance, LPV left not-instrumented. Best-value highlight only when ≥2 platforms have both spend and the metric.

## Scope / files

- `lib/dashboard/event-funnel.ts` — `FunnelCostCell`, `costPerUnit`, `costs` on `EventFunnelView`
- `lib/dashboard/__tests__/event-funnel.test.ts` — edge states + highlight
- `components/dashboard/event-report/event-funnel-card.tsx` — table under the funnel, `tonality` prop
- `components/report/event-report-view.tsx` + `internal-event-report.tsx` — pass tonality

## Validation

- [x] Helper tests for spend>0/metric=0, spend=0/metric>0, neither, Google no-reach, TikTok CPC highlight on/off
- [x] `npm test` — 4329 tests, 4326 pass, 0 fail, 3 skipped
- [x] `npx eslint` on changed files (no new errors)
- [x] `npm run build`

## Notes

- No new loader path: impressions/clicks/spend were already on `EventFunnelInput`.
- Loader unchanged.
