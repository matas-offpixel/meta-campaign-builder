## PR

- **Number:** 251
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/251
- **Branch:** `creator/patterns-spend-and-tile-sort-fixes`

## Summary

Fixes two regressions on the internal creative patterns page after the phase/funnel selectors:

- Total Spend now comes from the full date-windowed rollup query, independent of phase filtering or snapshot/tag alignment.
- Tile ordering within each dimension now follows the selected funnel metric, with null/no-spend rows last and spend-desc as the confidence tie-breaker.

## Scope / files

- `lib/reporting/creative-patterns-cross-event.ts`
  - Restores rollup-based `summary.totalSpend`.
  - Adds `summary.phaseSpend` for phase-filtered concept-group spend.
  - Keeps `fetchRollups` date-windowed via `sinceYmd` / `untilYmd`.
- `app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx`
  - Adds `sortTilesForFunnel`.
  - Sorts Top by CPM, Mid by CPC, Bottom by CPA.
  - Pushes null/no-spend metric rows to the bottom and breaks ties by total spend desc.

## Validation

- [x] `npm run lint -- lib/reporting/creative-patterns-cross-event.ts 'app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx'`
- [x] `npx tsc --noEmit`

## Notes

Dashboard visual validation is auth-gated from anonymous preview fetches. The low pre-fix spend looked close to one aligned event's active-creative snapshot spend, which is consistent with the duplicate/sibling event alignment issue tracked separately for Phase 5 dedupe; this PR does not attempt to solve duplicate events.
