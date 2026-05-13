# Session log — venue reach + London umbrella architecture plan

## PR

- **Number:** 414
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/414
- **Branch:** `cursor/creator/london-umbrella-architecture-plan`

## Summary

Plan PR (markdown only — no code changes) responding to Joe's follow-up
brief after PR #413 shipped. Joe filed two bugs:

- **Bug #1:** Manchester venue card reach 1,740,469 vs Meta UI 781,346,
  alleged residual N-counting that PR #413 missed.
- **Bug #2:** WC26-LONDON umbrella campaigns "bleeding into" individual
  London venue cards, alleged architectural attribution bug.

After tracing every venue-level Meta-metric surface, the diagnosis is:

1. **Bug #1 is NOT residual N-counting.** PR #413's dedup is wired into
   every reach surface (only one: `<VenueStatsGrid>`). The math
   reconciles as `N_days × daily_reach_per_event` for the deduped single
   sibling, ≈ 1,740,469. The 2.23× gap with Meta UI is the inherent
   sum-of-daily-reach vs lifetime-deduplicated-reach concept gap. The
   cell is labeled `"Reach (sum)"` and tooltipped as such, but Joe and
   his clients read it as Meta UI lifetime reach. Real bug, but it's a
   data-source / UX fix, not an N-counting fix. Proposed fix: cache
   per-`event_code` lifetime reach via a new Meta API call (no
   `time_increment`), surface as the canonical Reach cell.
2. **Bug #2 is misdiagnosed.** Umbrella synthetic event rows
   (`event_code = WC26-LONDON-PRESALE` / `-ONSALE`) carry the umbrella
   campaigns' reach / impressions / clicks. The venue page hard-filters
   `event_code === venue_code`, so umbrella metrics never enter
   per-venue cards today. Only spend is cross-allocated by
   `wc26-london-split.ts`, exactly as Joe explicitly approved. Kentish
   Town's reach 481,067 reconciles to the sum-vs-lifetime gap (1.45× vs
   Meta UI 331,552), same shape as Manchester. No architecture change
   needed; optional UX polish to render an explicit "London-wide series
   campaigns" panel deferred as PR B.

The Plan PR enumerates the trace, the math, the schema choice (Option B:
new `event_code_lifetime_meta_cache` table), the implementation arc (PR A
≈ small-medium, PR B optional polish), the acceptance criteria pinned to
production figures, and five open questions for Matas to greenlight.

## Scope / files

- New: `docs/PLAN_VENUE_REACH_AND_LONDON_UMBRELLA_2026-05-13.md`
  (~9KB, the architecture doc itself).
- New: this session log.
- **No code changes.** The implementation arc is documented but
  intentionally not started — Joe's brief explicitly demanded a Plan PR
  greenlight before coding.

## Validation

- [x] `npx tsc --noEmit` — no code touched.
- [x] `npm run build` — no code touched.
- [x] `npm test` — no code touched.
- [x] Markdown renders cleanly in GitHub preview (verified by reading the
  source after write — tables, code fences, cross-links all balanced).

## Acceptance criteria mapping

The Plan PR itself is the deliverable; downstream PR A's acceptance
criteria are listed in §4 of the plan doc and reproduce here:

- Manchester venue card Reach ≤ 820,000 (Meta UI 781,346 + 5%).
- Manchester Impressions stay at 1,972,012 (already correct post #413).
- Kentish Town Reach ≤ 348,000.
- Shepherd's Bush Reach ≤ 184,000 (PR #413 pinned 175,330).
- Tottenham / Shoreditch within ±5% of Meta UI.
- DOM-level regression test for each venue.
- Total Marketing Budget unchanged.

## Notes

- The plan recommends Option B (new `event_code_lifetime_meta_cache`
  table) over Option A (column on `events`) because the metric is
  per-`event_code` by nature and encoding that in the schema prevents a
  future maintainer from summing the column.
- One subtle finding worth promoting to a memory anchor:
  `feedback_collapse_strategy_per_consumer.md` is referenced in the
  brief but doesn't exist in the repo. The principle "different
  consumers need different aggregations" is exactly the shape of this
  bug — venue card wants lifetime reach, trend chart wants daily reach,
  current code conflates them. Worth writing the anchor as part of PR A
  so it grounds future debates.
- Flag for Matas: `wc26-london-split.ts` runs only as
  `/api/admin/event-rollup-backfill` post-processing. If the spend
  numbers ever look stale on London venue cards, that's the cron to
  re-trigger. Worth folding into the regular `rollup-sync-runner.ts`
  loop so it's automatic.
