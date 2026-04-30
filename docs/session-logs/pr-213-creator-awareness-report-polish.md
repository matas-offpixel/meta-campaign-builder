## PR
- **Number:** 213
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/213
- **Branch:** `creator/awareness-report-polish`
## Summary
Final awareness-report polish for BB26-KAYODE: hides empty TikTok blocks, switches brand-campaign daily reporting to awareness metrics, adds cross-platform trend data, and enriches the Google Ads block with creative cards plus best-effort demographic accordions.
## Validation
- [x] `npx tsc --noEmit`
- [x] `npx eslint components/report/event-report-view.tsx components/report/google-ads-report-block.tsx components/dashboard/events/event-daily-report-block.tsx components/dashboard/events/event-trend-chart.tsx components/dashboard/events/daily-tracker.tsx lib/google-ads/ lib/dashboard/paid-spend.ts lib/db/event-daily-timeline.ts lib/reporting/google-ads-share-types.ts app/share/ app/api/reporting/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`
## Notes
- Broad `npx eslint components/report/ lib/google-ads/ app/api/reporting/ app/share/` still fails on pre-existing `components/report/internal-event-report.tsx` hook-rule errors.
- Google Ads creative and demographics GAQL calls are catch-and-omit so report render is not blocked by field compatibility issues.
- Meta demographics are deferred to `creator/meta-demographics-share`; existing Meta insights helpers do not expose breakdown fetches in a small, low-risk path.
- Diff exceeded the 600-line target because the cross-platform chart and Google Ads extras required new shaping/rendering code.
