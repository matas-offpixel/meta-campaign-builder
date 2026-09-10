# Session log

## PR

- **Number:** 933
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/933
- **Branch:** `cursor/campaign-budget-ceiling`

## Summary

Matas asked for ad-set / campaign / both ceilings so a campaign cannot spend past the client's identified budget. The useful half is that the campaign number is not typed: it is remaining planned spend ÷ remaining days — the same plan `/api/cron/budget-pacing-check` already alerts against. ABO applies that as decrementing headroom (cheapest CPR first). CBO applies it to the campaign's own `daily_budget`. `baseCampaignBudget` is renamed to `baseAdSetBudget` because it was never a campaign total.

## Scope / files

- `lib/optimisation/campaign-ceiling.ts` — remaining allowance, scope resolution, ABO headroom, cheapest-CPR order, `readBaseAdSetBudget` walk
- `lib/optimisation/evaluate.ts` — CBO campaign-daily cap in `resolveScaleUpCap`; campaign-only scope ignores leftover `maxSingleAdSetBudget`
- `lib/optimisation/tick-runner.ts` — one ceiling per campaign; ABO headroom decrements within the run
- `lib/types.ts` / `lib/autosave.ts` / `lib/optimisation/presets.ts` / `lib/plan/from-existing.ts` — rename + scope fields; old key still read
- `components/steps/optimisation-strategy.tsx` — Ad set / Campaign / Both; surface max single ad-set; derived campaign ceiling by default
- `lib/db/campaign-automation-decisions.ts` + `app/api/cron/optimisation-tick/route.ts` — plan fields + spend fetch. `ENABLE_OPTIMISATION_WRITES` unchanged.

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5535 pass, 4 skipped)
- [x] no frame files touched, zero regenerated baselines. `frames:check` is a second production build; CI is the authority on Darwin-vs-Ubuntu frame diffs.

## Notes

Denominator is `computeCampaignBudgetPlan.plannedTotalPence`, not `ad_plans.total_budget`. Same figure the pacing cron already alerts on (enabled draft ad-set dailies × scheduled days). `ad_plans.total_budget` is the event paid-media pot (one row, several phases/channels) and would steal other channels' money.

Unset scope = today's ad-set-only behaviour. No plan and no typed ceiling = `campaign_ceiling_absent`, same budgets as today. Unreadable spend/plan = `campaign_ceiling_unreadable`, same budgets. Neither is silent unlimited.

`ENABLE_OPTIMISATION_PAUSE_WRITES` / the #929 pause ladder are not in this PR. `optimisationDryRunGates` 8-row table is untouched. `components/plan` freeze holds.
