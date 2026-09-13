# Session log

## PR

- **Number:** 938
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/938
- **Branch:** `cursor/armed-impact`

## Summary

The Armed row now shows what the loop did (net daily budget from applied writes) and what the metric did (`metric_value` first → latest, plus `resultCount` when present). The two sit on one timeline and are never multiplied. No Meta call. Daily budget, not spend.

## Scope / files

- `lib/optimisation/armed-impact.ts` — aggregates and honest labels
- `lib/db/armed-campaigns.ts` — one fleet scan (`applied` or last 7 days)
- `components/optimisation/armed-campaign-row.tsx` — impact line under the acting line
- `lib/optimisation/armed-read-model.ts` — `impact` on the row; rules' metric + window
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched
- `lib/plan/__tests__/drawer.test.ts` — #929 freeze: empty apply/gates diff now passes

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5682 pass, 4 skipped — local; CI check-runs are the record)

## Notes

- `ENABLE_OPTIMISATION_WRITES` unchanged and live. Read-only. No campaign becomes armed.
- No `pauseFloorBudget` write or control.
- No `(draft_id, decided_at desc)` index — say so, do not migrate.
- Cold-load count path stays at 2. Armed tab is 24 for ten campaigns (23 + one scan).
- Actual spend is Meta or `event_daily_rollups` (wrong while sixteen campaigns share Mall Grab). Not this PR.
