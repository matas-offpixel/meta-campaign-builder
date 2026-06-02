# PR #505: feat(brand-campaign): platform-responsive stats + per-day rollups backfill

**PR:** https://github.com/matas-offpixel/meta-campaign-builder/pull/505

## Summary

Four bugs on the Ironworks `brand_campaign` share report, all visible to the client. Fixed in one PR.

### Bug 1 — CPR locked to cross-platform spend

**Problem:** REGISTRATIONS card CPR changed depending on which platform pill was active (All = £1.19, Meta = £0.88, TikTok = £0.31) because `MetaReportBlock` was passing `filteredPaidMediaSpent` to `RegistrationsCard`.

**Fix:** Added `totalCrossPlatformSpent: number` prop to `MetaReportBlockProps`. The outer `EventReportView` passes `paidMediaSpent` (unfiltered cross-platform total) as `totalCrossPlatformSpent` regardless of the active pill. `RegistrationsCard` now always uses the cross-platform denominator.

### Bug 2 — Meta Campaign Stats block doesn't respond to filter

**Problem:** `MetaCampaignStatsSection` always rendered regardless of platform pill selection. TikTok pill showed Meta numbers.

**Fix:**
- Built `TikTokCampaignStatsSection` component in `meta-insights-sections.tsx` (Spend, Impressions, Reach, Clicks, CTR, CPM, Video Views, Conversions, CPA).
- Added `TikTokRollupTotals` type (sourced from `event_daily_rollups.tiktok_*`).
- Added `tiktokStats?: TikTokRollupTotals | null` to `MetaReportBlockProps` and `EventReportViewProps`.
- Share page now computes `tiktokRollupTotals` from `eventDailyData.rollups` and passes it down.
- `MetaReportBlock` now shows Meta block when pill ≠ "tiktok", TikTok block when pill = "tiktok" or "all" (when data present).

### Bug 3 — Creatives + Audience breakdown don't surface TikTok

**Problem:** Creatives and demographics sections stayed on Meta data when TikTok pill was active.

**Fix:** When `isBrandCampaign && platformFilter === "tiktok"`:
- Creative section shows "TikTok creative-level data syncing — check back in 24h" empty state.
- New TikTok audience section shows "TikTok audience breakdown syncing — check back in 24h" empty state.
- Meta breakdown/demographics sections are hidden.

### Bug 4 — Daily Trend chart and Daily Tracker only show one day

**Problem:** `event_daily_rollups` for brand_campaign events only had 1 row because the cron skipped them (no `general_sale_at`).

**Fix:**
- Added `loadBrandCampaignIds()` query to `cron-eligibility.ts` selecting `events.kind = 'brand_campaign'` with active statuses. Updated `mergeRollupSyncEligibilityIds` to include `brandCampaignIds`.
- New `app/api/events/[id]/backfill-rollups/route.ts` — POST endpoint that calls `runRollupSyncForEvent` with configurable `rollupWindowDays` (default 180, max 730). Auth: signed-in owner.
- Added "Backfill history" button to `EventDailyReportBlock` for `brand_campaign` events in dashboard mode. Shows result inline.

## Files changed

- `components/report/meta-insights-sections.tsx` — `TikTokRollupTotals` type + `TikTokCampaignStatsSection` component
- `components/report/event-report-view.tsx` — `totalCrossPlatformSpent` prop, `tiktokStats` prop, platform-responsive stats/creatives/demographics visibility
- `components/report/public-report.tsx` — thread `tiktokRollupTotals` through
- `app/share/report/[token]/page.tsx` — compute `tiktokRollupTotals` from rollups
- `lib/dashboard/cron-eligibility.ts` — add `brandCampaignIds` leg
- `app/api/events/[id]/backfill-rollups/route.ts` — NEW backfill endpoint
- `components/dashboard/events/event-daily-report-block.tsx` — "Backfill history" button

## Tests added

- `__tests__/components/registrations-card-cpr-locked.test.ts` — CPR stays £1.19 regardless of platform
- `__tests__/components/tiktok-stats-block.test.ts` — CPM/CTR/CPC/CPA math from rollup totals
- `__tests__/share-report/platform-stats-swap.test.ts` — Meta/TikTok block visibility per pill
- `lib/dashboard/__tests__/backfill-event-rollups.test.ts` — cron eligibility + rollup totals aggregation

## Checklist

- [x] `npx tsc --noEmit` — no new errors
- [x] `npm run build` — passes
- [x] `npm test` — 1980 pass, 5 fail (same 5 pre-existing failures)
