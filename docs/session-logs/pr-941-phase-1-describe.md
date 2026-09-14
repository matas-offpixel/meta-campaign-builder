# Session log

## PR

- **Number:** 941
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/941
- **Branch:** `cursor/phase-1-describe`

## Summary

Phase 1 describe. Per client, group launched_ad_sets and name the numbers. Rank nothing. Round 2: both selects page past PostgREST's 1,000-row cap; a failed read is `cells unreadable`, not `n=0`. Rebased onto `d3044b5` (post-#940).

## Scope / files

- `lib/optimisation/describe-cells.ts` — grouping, gate, line format, unreadable label
- `lib/db/describe-cells.ts` — two paged selects; named unreadable state
- `lib/db/armed-campaigns.ts` — describe load on the existing Armed GET
- `components/optimisation/armed-campaign-row.tsx` — line under impact; event page table
- No new write route. No migration. `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5739 tests, 5735 pass, 4 skipped)

## Notes

- Round-trips: 1 HTTP (`GET /api/optimisation/campaigns`). Describe adds 2 DB reads. Fleet (`kind: armed`) still computes the per-row line and drops the table payload.
- `launched_ad_sets` pages with `.range()` ordered by `meta_adset_id`. Decisions order `decided_at desc` and page until every ad set in the batch has a hit (or pages end). Not a DISTINCT ON view — that needs a migration. Existing index `(adset_id, decided_at desc)` covers per-adset order, not a global `decided_at` sort across an IN list. Named; no new index.
- Gate starting values 2026-09-14: n ≥ 5, ≥ 3 campaigns, ≥ £500 cumulative daily budget (budget-days since launch, accrued to now regardless of pause).
- Failed select → `cells unreadable`. Empty table stays `not enough data — n=0`.
- Split draft, equal counts: more recent `launched_at`. Table order is n descending — an order, not a verdict.
- Owner `n_backfill` can differ from the operator view: `user_id` is nullable on 175 and RLS hides null-user rows from non-operators.
