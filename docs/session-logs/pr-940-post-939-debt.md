# Session log

## PR

- **Number:** 940
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/940
- **Branch:** `cursor/post-939-debt`

## Summary

The five follow-ups this thread promised after #939: delete the launch-route freeze carve-out, stop treating #929 exports as additions vs main, bound the launched_ad_sets upsert so a hung connection cannot stall a launch, fail closed when eligibility calendar reads error, and close two pause-ladder test gaps from #929.

## Scope / files

- `lib/plan/__tests__/drawer.test.ts` — carve-out deleted; addedApply / addedGates must be empty
- `lib/launched-ad-sets/record.ts` — 3s Promise.race around the upsert; never throws
- `lib/optimisation/eligibility.ts` — `factsUnreadable` → `skip_facts_unreadable`
- `lib/db/campaign-automation-decisions.ts` — failed read is `facts_unreadable` via console.error; batch fail-closed
- `lib/optimisation/tick-runner.ts` — DecisionToInsert accepts the new skip action (evaluate.ts untouched)
- `lib/optimisation/__tests__/tick-runner.test.ts` — inserted.length + campaignsErrored; resultCount 14 / 15
- `lib/viz/tokens.ts` / `lib/plan/decisions-sheet.ts` — name the skip so Armed does not fall through
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5723 tests, 5719 pass, 4 skipped)

## Notes

- Conservative fork: any eligibility query error in the batch marks every draft `factsUnreadable`. We cannot mix null-from-error with a successful sibling query and call that absent.
- evaluate.ts stays off the file list; the new action is an EligibilitySkipAction unioned only on DecisionToInsert.
