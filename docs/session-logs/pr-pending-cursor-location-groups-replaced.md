# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/location-groups-replaced`

## Summary

Adding a searched city replaced `budgetSchedule.locationGroups` with the list from the render that built the click, so the DHB → Innellea draft kept New York and lost `country:AE` and `country:US`. The add now appends onto the schedule that is current when the update runs, and every wizard budget-schedule writer does the same.

## Scope / files

- `components/steps/budget-schedule.tsx` — search add, presets, remove, tier, and exclusions update the current list; schedule fields patch the current schedule
- `lib/wizard/use-campaign-draft.ts` — `updateBudgetSchedule` applies `(prev) => …` instead of installing a captured schedule
- `lib/wizard/budget-schedule-update.ts` — `patchBudgetSchedule`, `mapLocationGroups`, `mapExcludedLocations`, `applyBudgetScheduleUpdate`
- `lib/wizard/event-end-date.ts` — `applyEventEndToDraft` writes the end date onto the current schedule
- `lib/wizard/use-event-context.tsx` — event sync uses that helper
- `components/wizard/wizard-shell.tsx` — event defaults fill `startDate` with `patchBudgetSchedule`
- `components/plan/meta-drawer.tsx` — channel defaults fill the latest draft
- `lib/wizard/__tests__/location-groups-append.test.ts`

## Writer

Draft `c2067199-2001-473c-a6e3-6dba5bdae8d8` (`[I26-NYC] Registration`) was read and not written. Saved `locationGroups` is still only `manual_1791300925968` ("New York, New York, United States (+40 km)", id timestamp 2026-10-06T15:35:25.968Z). Budget amount 375, the dates, and GBP are the imported schedule.

The only producer of `manual_<timestamp>` is `addFromSearch`. It appended onto the picker's closed-over `groups` (`components/steps/budget-schedule.tsx:330`, `onChange([...groups, newGroup])`). `handleLocationGroupsChange` then installed that array by spreading the closed-over schedule (`components/steps/budget-schedule.tsx:1145`, `onBudgetChange({ ...bs, locationGroups: groups })`). `updateBudgetSchedule` (`lib/wizard/use-campaign-draft.ts:179`) did `updateDraft((d) => ({ ...d, budgetSchedule }))`, so the store's groups were discarded. The saved array has one element, so `groups` on that render was empty while the rest of `bs` was the live schedule.

Presets used the same closed-over list. Placement edits write `PlacementConfig`, not `locationGroups`. Per-row location edits write ad-set ids. `EventEndDateSync` and `EventDefaultsApplier` already spread the latest draft's schedule. `commitAccountSwitch` does too. The drawer channel-defaults effect was the remaining whole-draft replace (`setDraft(next)` from the render); it now fills the draft inside the updater.

## Validation

- [x] `npm test` — 6653 node tests, 6649 pass, 4 skipped, 0 fail; vitest 6 pass
- [x] `npm run build`
- [ ] `npx tsc --noEmit` — this repo typechecks with `npm run build`

## Notes

Test: `adding a searched city appends, and an event sync plus account switch in the same flush keep all three`. A schedule that already holds an operator `manual_` group keeps it through the same flush. The #1020 load repair is unchanged. The production draft was not updated.
