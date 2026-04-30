## PR

- **Number:** 204
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/204
- **Branch:** `creator/share-report-campaign-status-sort`

## Summary

Meta campaign breakdown rows now render by delivery status first, then spend within each status group, so genuinely active campaigns stay above paused or not-delivering campaigns even when inactive rows have higher historical spend.

## Scope / files

- `lib/insights/campaign-status.ts` adds `STATUS_PRIORITY` and `sortCampaignsByStatusThenSpend`.
- `components/report/meta-insights-sections.tsx` renders a sorted campaign copy in the breakdown table.
- `lib/insights/__tests__/campaign-status.test.ts` covers mixed-status ordering and spend-desc sorting inside status groups.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`

## Notes

- Scoped ESLint passed for touched files.
- Repo-wide `npm run lint` still fails on pre-existing `main` lint violations outside this PR; no touched-file diagnostics were introduced.
