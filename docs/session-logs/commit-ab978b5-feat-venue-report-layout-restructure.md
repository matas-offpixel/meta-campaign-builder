## Commit

- **SHA:** `ab978b5`
- **Pushed direct to:** `main` (procedural slip — see Notes)
- **Intended branch:** `feat/venue-report-layout-restructure` (created locally but never received the commit)
- **PR:** none — code went straight to main

## Summary

Restructure the venue report (internal `/clients/[id]/venues/[event_code]` + share `/share/venue/[token]`) around a single sticky header with global Timeframe + Platform filters, a Black-Butter style topline stats grid, and a multi-platform Daily Trend graph. Removes duplicated/scattered sections (top Performance Summary table, standalone Total Marketing Budget line, Linked Campaigns, per-section sync buttons) in favor of one sync button + clean section ordering.

## Scope / files

**New**
- `components/share/venue-report-header.tsx` — sticky header: title (from `getSeriesDisplayLabel`), Live indicator, Sync Now, sub-tab bar, days-until chip, global Timeframe + Platform selectors
- `components/share/venue-stats-grid.tsx` — Black-Butter style 10-cell topline grid with platform-specific accents + empty-state cards
- `lib/dashboard/platform-colors.ts` — central color spec (Meta `#1877F2`, Google Ads `#EA4335`, TikTok `#000`) + `parsePlatformParam`
- `lib/dashboard/venue-stats-grid-aggregator.ts` — pure aggregator: `aggregateStatsForPlatform`, `aggregateStatsForAll`, `buildWindowDaySet`
- `lib/dashboard/__tests__/platform-colors.test.ts` (5 cases)
- `lib/dashboard/__tests__/venue-stats-grid-aggregator.test.ts` (14 cases)

**Modified**
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — wire `?tf=`, `?platform=`, `?tab=` URL params; mount `VenueReportHeader`; conditional render of Performance / Creative Insights / Funnel Pacing per active tab; pass `syncEventIds` for fan-out
- `app/share/venue/[token]/page.tsx` — same as above for share route; passes `isShared=true` to `CreativePatternsPanel` + `FunnelPacingSection` (no new API routes needed — those server components already use service-role client when shared)
- `components/share/venue-full-report.tsx` — restructure section order (Perf Summary → Additional Entries → Stats Grid → Daily Trend → Daily Tracker → Event Breakdown → Active Creatives); drop standalone Total Marketing Budget line + Linked Campaigns; thread `platform` + `datePreset` + `customRange` through children; derive `hasTikTokAccount` / `hasGoogleAdsAccount` from rollup data
- `components/share/venue-daily-report-block.tsx` — split into `VenueTrendChartSection` + `VenueDailyTrackerSection` (shared `useVenueReportModel` hook); `projectTimelineToPlatform` filters timeline by platform; daily tracker default-collapsed to 14 days
- `components/share/venue-active-creatives.tsx` — accept `platform` prop; renders "Not yet wired" card for non-Meta platforms (skips Meta API fetch)
- `lib/db/client-portal-server.ts` — extend `DailyRollupRow` with optional Meta awareness metrics (`meta_impressions`, `meta_reach`, `meta_video_plays_3s/15s/p100`, `meta_engagements`) + TikTok metrics (`tiktok_impressions`, `tiktok_video_views`, `source_tiktok_at`) + Google Ads metrics (`google_ads_impressions`, `google_ads_clicks`, `google_ads_video_views`, `source_google_ads_at`); update `fetchAllDailyRollups` SELECT

## Validation

- [x] `npx tsc --noEmit` — 0 new type errors (pre-existing errors in untouched files only)
- [x] `npm test` — 797/797 pass (19 new from this commit)
- [x] `npm run lint` — 0 new errors in changed files
- [x] `npm run build` — production build clean
- [ ] Internal `/clients/[id]/venues/4TF26-ARSENAL-CL-FL` renders title "Arsenal Champions League Final – London" (verify post-deploy)
- [ ] Share `/share/venue/[token]` renders identical layout to internal (verify post-deploy)
- [ ] Sticky header stacks vertically below 640px (verify post-deploy)
- [ ] All 4 platform tabs (All / Meta / TikTok / Google Ads) render even with no TikTok/Google Ads data (verify post-deploy)
- [ ] PR #339 trend chart leading-zero trim still in effect (preserved — `useVenueReportModel` was untouched here)

## Notes

### Procedural slip — direct push to main

This commit landed on `main` and was auto-pushed without going through a feature branch + PR. Reflog shows what happened:

```
16:18  checkout main → feat/venue-report-layout-restructure   (branch created)
…       (all edits made on the feat branch, working tree dirty)
16:35  checkout feat/venue-report-layout-restructure → main   (branch switch, working tree carried)
16:35  checkout main → creator/audience-ig-multi-select       (parallel work)
16:37  commit + checkout back to main, pull (creator branch landed via PR)
16:38  commit c913c42 on main (session log rename)
16:39  commit ab978b5 on main (this commit) — should have been on feat branch
```

A parallel `creator/audience-ig-multi-select` thread merged to main mid-session, which involved checking back to main; my staged tree carried over. By the time `git commit` ran, `HEAD` was on main, so the commit + auto-push went straight there.

After discussing with the user, accepted as-is rather than reverting (code is identical to what an auto-merged squash PR would produce, all gates green). For future cross-thread sessions: re-run `git rev-parse --abbrev-ref HEAD` immediately before `git commit` if any branch switching may have happened mid-session.

### Cross-thread coordination

`components/share/**` is shared between the dashboard thread and the share thread. The user explicitly requested this restructure across both surfaces (internal + share parity).

### Platform color choice

TikTok: black (`#000`) per user choice (option A vs pink `#FE2C55`).

### Share-route tab parity

Insights + Pacing tabs work on the share route via the existing `isShared` flag on `CreativePatternsPanel` + `FunnelPacingSection` — both already use service-role Supabase client when shared. No new API routes needed.

### Lifetime vs windowed

- Performance Summary (3 cards) + Event Breakdown stay lifetime-scoped (decision pills).
- Stats Grid + Daily Trend + Daily Tracker + Active Creatives respond to the global Timeframe filter.

### Out of scope (follow-ups)

- **Event Breakdown SPEND column stays Meta-allocator-aware.** Per-platform per-event allocation needs a parallel TikTok/Google Ads allocator model that doesn't exist yet (`lib/dashboard/venue-spend-model.ts` is Meta-only). Non-Meta data still flows through Stats Grid + Daily Trend.
- **Active Creatives is Meta-only today.** TikTok + Google Ads creatives card grids will plug into the platform tab when their snapshot tables are wired (currently shows "Not yet wired up" empty state for non-Meta).
- **Trend chart "All" view sums Meta + TikTok via `paidSpendOf`; Google Ads spend isn't yet a chart series.** Same allocator-model gap.
