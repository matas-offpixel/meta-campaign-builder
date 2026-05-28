# Session log — hotfix: spendReconciliation.spent source divergence

## PR

- **Number:** pending
- **URL:** (to be filled after `gh pr create`)
- **Branch:** `cursor/funnel-pacing-spend-recon-hotfix`

## Summary

Hotfix for #475. `spendReconciliation.spent` was using
`SUM(COALESCE(ad_spend_allocated, ad_spend))` — the same COALESCE fallback
`sumVenueSpend` uses for the capacity-target metrics. On dates where the
allocator has not yet run (stall post 2026-05-23), raw `ad_spend` is
fanned-out across all fixtures, so the fallback over-counts by fixture count.
Edinburgh: £9,410 in Funnel Pacing vs £6,986 in Performance Summary.

Fix: `computeSpendReconciliation` now computes `spent` internally as
`SUM(ad_spend_allocated ?? 0) + SUM(ad_spend_presale ?? 0)` — no COALESCE
fallback. Same arithmetic Performance Summary uses. The `firstSpendDate` scan
uses the same allocated-only filter (found an earlier first date: 2026-01-21).

`metrics.spend` and `slidingScale` still use `sumVenueSpend` (COALESCE) for
the per-stage capacity targets — those are intentionally separate.

## Scope / files

- `lib/dashboard/venue-canonical-funnel.ts` — `computeSpendReconciliation`:
  drop `spent` param; compute spent + firstSpendDate using allocated-only
  arithmetic (9 lines changed)

## Validation

- [x] All 22 tests pass (no test changes needed — fixtures use `ad_spend_allocated`)
- [x] `npm run build` — clean (run in #475 worktree before cherry-pick)

## Edinburgh post-fix (2026-05-28)

| Field             | Before (buggy) | After (fixed)  |
|-------------------|---------------|----------------|
| Spent             | £9,410         | £6,986 ✓        |
| First spend date  | 2026-01-28     | 2026-01-21      |
| Days of spend     | 120            | 127             |
| Spent per day     | £78            | £55             |
| Live CPT          | £2.69          | £2.00           |
| Required per day  | £332           | £247            |
| Warning           | additional_needed | additional_needed (unchanged) |

Matches Performance Summary exactly. ✓

## Notes

- The under-reporting in Performance Summary and Funnel Pacing (unallocated
  days post-stall contribute £0 to both Spent figures) is a known issue
  tracked separately. Once the allocator catches up (Task A), both surfaces
  will reflect reality automatically — no UI changes needed.
- Refs: #475 (PR-C), #474 (source-of-truth contract).
