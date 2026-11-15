# Session log

## PR

- **Number:** 1010
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1010
- **Branch:** `cursor/budget-type-and-level`

## Summary

Step 6 Lifetime and Campaign Level now reach Meta. A lifetime ad set sends `lifetime_budget` and `end_time`. A campaign-level budget sends `daily_budget` or `lifetime_budget` plus `LOWEST_COST_WITHOUT_CAP` on the campaign, and the ad sets carry neither a budget nor a bid strategy. The launch preflight refuses a lifetime ad set with no positive `lifetime_budget` or no `end_time`, a daily ad set with no positive `daily_budget`, and a CBO launch whose campaign has no budget or whose ad sets still carry one. Flipping Daily ↔ Lifetime converts the row amounts. `attach_campaign` reads the target campaign's budget. Review states the resolved mode above Launch.

## Scope / files

- `lib/meta/adset.ts`, `lib/meta/campaign.ts`, `lib/meta/client.ts` — wire shapes from the paused probes
- `lib/meta/budget-launch.ts`, `app/api/meta/launch-campaign/route.ts` — refuse a zero lifetime or daily budget, and a CBO ad set that still carries one, before any Graph POST. `attach_campaign` reads the target campaign.
- `lib/types.ts`, `components/steps/budget-schedule.tsx` — `budgetLifetime`, "total" rows, lifetime footer; CBO hides the ad-set amounts
- `lib/validation.ts`, `lib/meta/launch-error-classify.ts` — end date required; subcode 1487094
- `lib/budget-pacing/plan.ts`, `lib/meta/import/map.ts` — lifetime denominator; CBO/lifetime import
- `lib/meta/__fixtures__/budget-probes/zz-budget-probe.json`

## Validation

- [x] `npm test`
- [x] `npm run build`

## Notes

Campaign `stop_time` is read-only on Marketing API v21.0. Probe c accepted a `stop_time` write and the readback omitted it. A budget-less ad set with `end_time` is what Meta stores, and the campaign then reads that back as `stop_time` (`cSchedule` in the fixture). Both follow-up objects were deleted.

Paused probes on `act_606252931141334`, all deleted:

- (a) ABO lifetime ad set `120252046472350755` on campaign `120252046472160755` — create 200, PAUSED, `lifetime_budget` 5000, `end_time` set, no `daily_budget` sent
- (b) CBO daily campaign `120252046472630755` — create 200, `daily_budget` 2000, `bid_strategy` LOWEST_COST_WITHOUT_CAP. Ad set `120252046473010755` — create 200, no budget, no bid strategy
- (c) CBO lifetime campaign `120252046473540755` — create 200, `lifetime_budget` 5000. `stop_time` was sent and not stored. The schedule that stuck is ad set `end_time` on campaign `120252046530340755` / ad set `120252046531910755`
- (d) ABO lifetime ad set with no `end_time` — HTTP 400, code 100, subcode 1487094, "No end date entered"

#605 added no CBO detection in attach modes. Before this PR, `attach_campaign` always sent `daily_budget` from `budgetPerDay`. It now reads the target: a positive campaign `daily_budget` or `lifetime_budget` means the new ad sets are budget-less; otherwise the draft's budget type decides `daily_budget` or `lifetime_budget` from the ad set rows. The draft's budget level is ignored in attach modes. TikTok budgets were not changed. Existing daily drafts that stay daily still send `daily_budget` from `budgetPerDay`.

Follow-ups, not in this PR. These still read `budgetPerDay` only, so a lifetime launch records 0 there:

- `lib/launched-ad-sets/snapshot.ts` (reads `budgetPerDay` around line 54)
- `lib/optimisation/armed-table.ts` (around line 175)
- `lib/db/campaign-automation-decisions.ts` (around line 151)
- `lib/db/budget-pacing-campaigns.ts` (around line 73)
