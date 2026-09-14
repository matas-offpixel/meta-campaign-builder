# Session log

## PR

- **Number:** 941
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/941
- **Branch:** `cursor/phase-1-describe`

## Summary

Phase 1 describe. Per client, group launched_ad_sets and name the numbers. Rank nothing. Round 3: cells are keyed by `client_id`; decisions are asked only for armed drafts; both page loops have a hard cap of 20 and go unreadable when it is hit.

## Scope / files

- `lib/optimisation/describe-cells.ts` — grouping includes `client_id`
- `lib/db/describe-cells.ts` — two paged selects; armed-draft filter; page cap
- `lib/db/armed-campaigns.ts` — passes armed draft ids from the load already in hand
- `components/optimisation/armed-campaign-row.tsx` — line under impact; event page table
- No new write route. No migration. `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5745 tests, 5741 pass, 4 skipped)

## Notes

- A cell is a client's cell. Fleet no longer pools `lookalike_group · registration · presale` across clients.
- Decisions read is restricted to ad sets whose draft is in the armed set already loaded. Non-armed launched rows stay in `n` and are not queried. Event page metric series is from armed drafts on that load; other-event armed ad sets of the same client still count in `n`.
- Missing index if the draft_id filter needs one: `(draft_id, adset_id, decided_at desc)`. Not adding it. Existing `(adset_id, decided_at desc)` remains the access path.
- `DESCRIBE_PAGE_SIZE` (1000) must equal PostgREST max-rows. Twenty pages is the cap; hitting it is `cells unreadable`.
- Latest non-null metric: pager skips null `metric_value` when deciding a hit. Secondary order `id desc`.
