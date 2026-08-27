# Session log — plan loop fixes

## PR

- **Number:** 870
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/870
- **Branch:** `cursor/plan-loop-fixes`

## Summary

Four live click-through fixes from #867/#868/#869: /plan/new no longer persists on derived defaults; end-date chips omit null sale columns; /plans row actions collapse to a ⋯ menu; the active split chip shows the effective ratio.

## Scope / files

- `lib/plan/persist-policy.ts` — derived defaults never count as a user edit
- `components/plan/plan-workspace.tsx` — lifetime sync no longer flips `hasUserEdit`
- `lib/plan/event-end-dates.ts` — `presentEventTimestamp`; no event_date fallback
- `components/viz/overflow-menu.tsx` + `PlanRow` — single ⋯ menu; #863 Dialog stays
- `lib/plan/budget-split.ts` `presetChipCopy` — active chip = effective split

## Validation

- [x] `npx tsx --test lib/plan/__tests__/plan-loop-fixes.test.ts`
- [x] Touched-file eslint clean
- [x] `npm test` — 4698 / 4695 pass / 0 fail / 3 skipped
- [x] `npm run build` — pass
- [x] Falsify 1, 2, 4 against parent `4f14a25`

## Notes

Stray "Untitled plan" rows from the regression are the operator's to delete.
Parent sha: `4f14a25`.
