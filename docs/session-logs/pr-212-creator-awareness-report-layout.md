## PR
- **Number:** 212
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/212
- **Branch:** `creator/awareness-report-layout`
## Summary
BB26-KAYODE is a `brand_campaign` awareness report with no ticket-sales funnel. This hides ticket-centric share-report metrics, expands the Google Ads awareness block, and fixes Performance Summary ad spend to include Google Ads spend alongside Meta/TikTok.
## Validation
- [x] `npx tsc --noEmit`
- [x] `npx eslint components/report/event-report-view.tsx components/report/google-ads-report-block.tsx components/report/meta-insights-sections.tsx components/report/public-report.tsx components/dashboard/events/event-summary-header.tsx components/dashboard/events/event-daily-report-block.tsx lib/google-ads/ app/api/reporting/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`
## Notes
- Broad `npx eslint components/report/ lib/google-ads/ app/api/reporting/` still fails on pre-existing `components/report/internal-event-report.tsx` hook-rule errors.
- Verified Google Ads v23 video quartile fields; Top Regions / Demographics / Interests are deferred because they require separate segmented GAQL queries.
