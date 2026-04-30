## PR

- **Number:** 203
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/203
- **Branch:** `creator/share-report-delivery-heuristic`

## Summary

Share-report campaign status now applies a 24h delivery heuristic on top of Meta `effective_status`: established campaigns that still look `ACTIVE` at campaign level but have no recent impressions are displayed as `NOT_DELIVERING` with a small explanatory footnote.

## Scope / files

- `lib/insights/campaign-status.ts` adds the shared delivery heuristic and `(no delivery in 24h)` status-reason label.
- `lib/reporting/event-insights.ts` fetches matched campaign impressions for `maximum` and `today`, then applies the heuristic after `effective_status` normalization.
- `lib/insights/meta.ts` applies the same heuristic in the share-report Meta payload path by fetching lifetime/today campaign insight rows alongside the selected timeframe row.
- `lib/insights/types.ts` adds optional `statusReason` on `MetaCampaignRow`.
- `components/report/meta-insights-sections.tsx` renders the optional status-reason footnote next to the badge.
- `lib/insights/__tests__/campaign-status.test.ts` covers active-with-delivery, active-with-no-recent-delivery, brand-new active, and paused/issues unchanged cases.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`

## Notes

- Scoped ESLint passed for all touched files.
- Repo-wide `npm run lint` still fails on pre-existing `main` lint violations outside this PR; no touched-file diagnostics were introduced.
