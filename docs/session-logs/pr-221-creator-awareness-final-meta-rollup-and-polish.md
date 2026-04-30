## PR

- **Number:** 221
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/221
- **Branch:** `creator/awareness-final-meta-rollup-and-polish`

## Summary

Final polish for the BB26-KAYODE awareness share: Meta awareness metrics now flow into daily rollups, awareness reporting tiles focus on video plays and engagements, the Daily Trend platform pill drives Daily Tracker platform values, and Google Ads sub-penny CPV/CPE values render in pence.

## Scope / files

- Migration `063`: `meta_impressions`, `meta_reach`, `meta_video_plays_3s`, `meta_video_plays_15s`, `meta_video_plays_p100`, `meta_engagements` on `event_daily_rollups`.
- Meta daily insights and rollup upserts now parse/write impressions, reach, video actions, and `post_engagement`.
- New session-bound, owner-only `/api/admin/event-rollup-backfill` route runs Meta, Google Ads, and TikTok rollup legs for a single event.
- Brand-campaign UI updates for Meta campaign stats, Daily Trend/Tracker platform sync, and Google Ads CPV/CPE pence formatting.

## Validation

- [x] `npx tsc --noEmit`
- [x] Changed-file ESLint: `npx eslint components/report/meta-insights-sections.tsx components/report/google-ads-report-block.tsx components/dashboard/events/event-daily-report-block.tsx components/dashboard/events/event-trend-chart.tsx components/dashboard/events/daily-tracker.tsx lib/db/event-daily-rollups.ts lib/db/event-daily-timeline.ts lib/insights/types.ts lib/insights/meta.ts lib/dashboard/rollup-sync-runner.ts app/api/admin/event-rollup-backfill/route.ts lib/dashboard/__tests__/funnel-aggregations.test.ts`
- [x] Requested unit tests: `node --experimental-strip-types --test 'lib/insights/__tests__/*.test.ts' 'lib/db/__tests__/*.test.ts' 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes

- Full scoped ESLint still reports pre-existing `react-hooks/set-state-in-effect` errors in `components/dashboard/events/event-plan-tab.tsx` and `components/report/internal-event-report.tsx`; changed-file ESLint is clean.
- Ops to-do post-merge: apply migration `063` via Supabase, then trigger BB26-KAYODE backfill with `POST /api/admin/event-rollup-backfill` and `{ "event_id": "a01c9aef-bcc0-4604-89b3-540a76e61773" }`.
