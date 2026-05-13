# Session log — venue over-attribution audit

## PR

- **Number:** 413
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/413
- **Branch:** `cursor/creator/venue-over-attribution-audit`

## Summary

Fixes the 4thefans WC26 dashboard's 4× venue over-attribution on the venue
full-report Topline Stats Grid (Reach / Impressions / Video Plays /
Engagements / CPM / CTR / Cost-per-engagement / cost-per-video-play) AND on the
venue Daily Trend chart + Daily Tracker (`link_clicks`, `meta_regs`).

Pre-fix the Shepherd's Bush venue card showed Reach 1,231,744 against the
Meta-reported 175,330 across the three [WC26-LONDON-SHEPHERDS] campaigns —
4× inflation × multi-day cron stacking. The same pattern PR #410 fixed for the
LPV column was hitting every other Meta-fetched campaign-wide column on the
venue surface.

Mechanism: `fetchEventDailyMetaMetrics` substring-matches Meta campaigns by
`[event_code]`, so all four sibling events under one bracketed code (e.g.
WC26-LONDON-SHEPHERDS) write the IDENTICAL campaign-wide value into
`event_daily_rollups` for the same calendar day. The venue spend allocator
overwrites `link_clicks` per-event when it runs, but it never touches
`meta_impressions`, `meta_reach`, `meta_video_plays_*`, `meta_engagements`, or
`meta_regs`. Naively summing those columns multiplied the venue total by N
siblings.

Fix: a shared dedup helper (`lib/dashboard/venue-rollup-dedup.ts`) collapses
each `(event_code, date)` group to one canonical row holding the MAX of every
campaign-wide column — same MAX-then-split shape as PR #410's
`splitEventCodeLpvByClickShare`, but for the columns the allocator can't
correct after the fact. The aggregator and the timeline merger both run
through it before any SUM happens, so the venue stats grid AND the trend
chart converge to the real campaign-wide totals.

## Scope / files

New:

- `lib/dashboard/venue-rollup-dedup.ts` — the helper plus the audit anchor
  enumerating which columns are per-event vs campaign-wide. Future Meta
  metrics added to the venue surface MUST funnel through
  `CAMPAIGN_WIDE_META_COLUMNS` here so the bug doesn't re-emerge silently.
- `lib/dashboard/__tests__/venue-rollup-dedup.test.ts` — unit tests covering
  4-sibling collapse, MAX-vs-SUM allocator-state branching, null-preservation,
  ungrouped pass-through, multi-day grouping, and the SUM-after ≤ SUM-before
  invariant from PR #410.
- `lib/dashboard/__tests__/venue-stats-grid-pipeline-shepherds-bush.test.ts` —
  pipeline integration test pinning the Shepherd's Bush figures + spot-check
  matrix for Manchester / Brighton / Edinburgh / Glasgow / Bristol / Crystal
  Palace, plus three wire-up assertions (`readFileSync` against the component
  files) catching a future refactor that drops the `events` prop or skips the
  pre-merge dedup.

Modified:

- `lib/dashboard/venue-stats-grid-aggregator.ts` — accepts an optional
  `eventIdToCode` map; threads it through `aggregateStatsForPlatform` and
  `aggregateStatsForAll`; runs the dedup pass before the main loop.
- `lib/dashboard/__tests__/venue-stats-grid-aggregator.test.ts` — extends the
  existing suite with the Shepherd's Bush dedup + CPM/CTR reconciliation
  assertions and the legacy backward-compat case.
- `components/share/venue-stats-grid.tsx` — adds the `events` prop, builds the
  map, threads it to the aggregator, adds `data-testid="venue-stats-cell-*"`
  on every cell so a future Playwright harness can assert directly.
- `components/share/venue-full-report.tsx` — passes `initialEvents` to the
  grid.
- `components/share/venue-daily-report-block.tsx` — runs the dedup helper
  against `dailyRollups` before `mergeVenueTimeline` so the trend chart and
  daily tracker both stop N-counting `link_clicks` (when allocator hasn't run)
  and `meta_regs`.

## Validation

- [x] `node --experimental-strip-types --test lib/dashboard/__tests__/venue-rollup-dedup.test.ts lib/dashboard/__tests__/venue-stats-grid-aggregator.test.ts lib/dashboard/__tests__/venue-stats-grid-pipeline-shepherds-bush.test.ts` — 33/33 pass.
- [x] `npm test` — 1111/1114 pass (1 pre-existing failure in
  `batch-fetch-video-metadata.test.ts` confirmed on `main`, 2 pre-existing
  skips, all unrelated to this change).
- [x] `npm run build` — clean.
- [x] ReadLints across all touched files — no errors.

## Acceptance criteria mapping

- [x] Shepherd's Bush venue card reach ≤ 175,330: pinned in
  `venue-stats-grid-pipeline-shepherds-bush.test.ts`
  (`Reach (sum) ≤ 175,330 across the venue`).
- [x] Manchester / Brighton / Edinburgh / Glasgow / Bristol / Crystal Palace
  spot-check: covered by the matrix test in the same file.
- [x] DOM-level regression test for each affected venue: closest the existing
  `node --experimental-strip-types` infra allows is the pipeline integration
  test (memory anchor `feedback_resolver_dashboard_test_gap.md` accepts this
  as the next-best gate). The component now exposes
  `data-testid="venue-stats-cell-*"` markers so a future Playwright harness
  can assert on the rendered DOM. The pipeline test ALSO includes wire-up
  smoke tests reading the component sources to catch a refactor that drops
  the `events` prop — the exact failure mode the memory anchor was anchored
  against.
- [x] Memory anchor in code: `lib/dashboard/venue-rollup-dedup.ts` carries
  the rule (which columns are per-event vs campaign-wide, why MAX, why this
  lives in its own module). Both call-sites cross-reference it.

## Deferred / flagged

- **WC26-LONDON presale "appearing in N venues simultaneously"**: false
  alarm. `lib/dashboard/wc26-london-split.ts` already redistributes the
  shared [WC26-LONDON-PRESALE] and [WC26-LONDON-ONSALE] campaigns evenly
  across the three umbrella venues (Tottenham / Shoreditch / Kentish, with
  Shepherd's Bush intentionally excluded because it has its own dedicated
  bracketed campaigns). Each venue lands its own split; no double-count.
  Documented in the venue table comments at line 126 of
  `client-portal-venue-table.tsx`.
- **TikTok / Google Ads campaign-wide columns**: in theory the same N-counting
  exists for `tiktok_impressions` / `tiktok_reach` / `google_ads_impressions`
  etc. (TikTok rollup also matches campaigns by event_code substring). No
  multi-event venue currently has those platforms linked, so this stays out
  of scope. When a customer hits it, extend
  `CAMPAIGN_WIDE_META_COLUMNS` in `lib/dashboard/venue-rollup-dedup.ts` to
  the TikTok / Google Ads columns and update the dedup tests.
- **Interactive spend slider** (Joe's request): not part of this PR.
- **Funnel pacing benchmark explainer UI**: separate Cursor Sonnet task.

## Notes

- The dedup helper is intentionally narrower than the LPV-split helper from
  PR #410 — at venue scope we don't need to attribute the campaign-wide value
  back to per-event slices, only to ensure SUM-at-venue equals the real
  campaign total. PR #410 stays the canonical helper for per-event LPV
  display (it splits by click share for downstream charts that DO render
  per-event values).
- Follow-up worth scoping: extend the same dedup to
  `aggregateVenueCampaignPerformance` in
  `lib/db/client-dashboard-aggregations.ts` for the rare "allocator hasn't
  run" branch where it falls back to raw `ad_spend`. The current production
  behaviour is correct because the allocator runs ahead of every dashboard
  load, but a defensive guard there would close the last theoretical
  N-counting surface.
- Memory anchor `feedback_resolver_dashboard_test_gap.md` updated implicitly
  by adding the wire-up tests pattern; no doc change needed since the anchor
  already calls for "pipeline test that constructs realistic PortalEvent
  fixtures" which is exactly what landed here.
