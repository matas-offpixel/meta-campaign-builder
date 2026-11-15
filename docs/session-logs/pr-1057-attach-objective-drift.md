# Session log

## PR

- **Number:** 1057
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1057
- **Branch:** `cursor/attach-objective-drift`

## Summary

Adding an ad set to "[NX26-AZYR] Azyr b2b PB69 - On Sale" 409'd because the launch compared voted sub-objectives (`purchase` vs `initiate_checkout`) while both sides were `OUTCOME_SALES`. The drift check now compares the Meta campaign objective only. A different conversion event under that objective is logged and shown on Review; the new ad set keeps the draft's event.

The stored snapshot (draft `17b66f12-c796-459e-93fc-9cfdfa6f3430`, captured 2026-10-03T09:48:45Z) has `objective: OUTCOME_SALES` and `internalObjective: purchase`, and no `objectiveSource`, `adSetCount`, or `conversionEvent`. That is the campaign-objective fallback, not an ad-set vote. Today's picker refetch (`withAdSets=1`, 14:50 UTC) did not log the subcode-99 retry and did not rewrite the snapshot. The 15:06 and 15:07 launch attempts then voted `initiate_checkout` from `adsets.limit(50)`. Cause (a), not an Ads Manager edit after a real vote (b).

## Scope / files

- `lib/meta/attach-objective.ts` — one drift helper, vote-drift log line, Review line, unread badge
- `app/api/meta/launch-campaign/route.ts` — 409 only on raw Meta objective; new ad set keeps the draft event
- `lib/meta/campaign-ledger.ts` — same message, raw objectives
- `lib/meta/client.ts`, `app/api/meta/campaigns/route.ts` — subcode-99 retry sets `adSetsUnread`
- Step 1 badge and Review line
- CBO lifetime attach already sends `end_time` from `budgetSchedule.endDate` (`lib/meta/adset.ts`) and omits the ad set budget when `budgetScheduleForAttach` forces campaign level (`lib/meta/budget-launch.ts`)

## Validation

- [x] `npx tsc --noEmit` (no new errors in touched files; one pre-existing fixture cast in `attach-objective-vote.test.ts`)
- [x] `npm run build`
- [x] `npm test` (7309 pass, 4 skipped, plus 8 vitest)

## Notes

The launch route has no `validate_only` / dry-run flag. AZYR was not launched.
