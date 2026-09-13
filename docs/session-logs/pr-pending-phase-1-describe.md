# Session log

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/phase-1-describe`

## Summary

Phase 1 describe. Per client, group launched_ad_sets and name the numbers. Rank nothing. The table is empty tonight — that is the first honest state. `docs/session-logs/self-learning-scope-2026-09-13.md` is not in this repo; the prompt is the spec.

## Scope / files

- `lib/optimisation/describe-cells.ts` — pure grouping, gate, line format
- `lib/db/describe-cells.ts` — two selects, bounded by client_id
- `lib/db/armed-campaigns.ts` — one extra describe load on the existing Armed GET
- `components/optimisation/armed-campaign-row.tsx` — line under impact; event page table
- No new write route. No migration. `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5722 tests, 5718 pass, 4 skipped)

## Notes

- Round-trips: 1 HTTP (`GET /api/optimisation/campaigns`). Describe adds 2 DB reads (launched_ad_sets by client_id, decisions by adset_id). No per-row query on the Armed tab.
- Indexes already present: `(client_id, source_type)` on launched_ad_sets, `(adset_id, decided_at desc)` on decisions. No new index.
- Gate starting values 2026-09-14: n ≥ 5, ≥ 3 campaigns, ≥ £500 cumulative daily budget.
- Budget is daily × inclusive UTC days since launched_at. Never labelled spend.
- Backfill has not been run. Empty table is `not enough data — n=0`.
