## PR

- **Number:** 202
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/202
- **Branch:** `creator/share-report-effective-status`

## Summary

Share-report campaign breakdowns now treat Meta `effective_status` as the delivery source of truth, so campaigns whose configured `status` is `ACTIVE` but whose effective delivery state is paused or blocked no longer display as active.

## Scope / files

- `lib/insights/campaign-status.ts` adds the shared Meta effective-status to display-status mapping and badge presentation helpers.
- `lib/insights/meta.ts` normalizes campaign rows from `effective_status` before the share-report payload is rendered.
- `lib/reporting/event-insights.ts` uses the same mapping for the event campaign-insights path so reporting surfaces stay consistent.
- `components/report/meta-insights-sections.tsx` renders the new `WITH_ISSUES` (orange) and `NOT_DELIVERING` (grey) badge states.
- `lib/insights/__tests__/campaign-status.test.ts` covers every requested mapping plus the `status=ACTIVE` / `effective_status=ADSET_PAUSED` regression.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`

## Notes

- Scoped ESLint passed for all touched files.
- Repo-wide `npm run lint` still fails on pre-existing `main` lint violations outside this PR; no new linter diagnostics were reported for the files changed here.
