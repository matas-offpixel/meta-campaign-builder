# Ad set phase from the campaign objective

## PR

- **Number:** 1033
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1033
- **Branch:** `cursor/phase-from-objective`

## Summary

Matas, 2026-10-08: an ad set's phase comes from the campaign objective, not the event calendar. `launched_ad_sets.phase_at_launch` is:
- `presale` when the objective is `registration` (Complete Registration);
- `on_sale` for `purchase`, `initiate_checkout`, `traffic`, `awareness` and `engagement`;
- null when the objective is missing or unknown, never a guess.

The launch recorder and the backfill both use it. Learning-loop stage now reads `phase_at_launch` ahead of event sale dates, so a registration ad set running after general sale is still a registration-stage ad. `campaign_plans.phase` keeps its event-date derivation (`lib/plan/phase.ts` and `deriveCampaignPlanPhase` are unchanged).

## Scope / files

- `lib/launched-ad-sets/snapshot.ts`: `phaseAtLaunchFromObjective`, with the rule quoted in its doc comment. `phaseAtLaunchFromEvent` stays exported.
- `lib/launched-ad-sets/launch-recorder.ts`: phase from `draft.settings.objective`, the same value written to `objective`. The events lookup now selects only `client_id`.
- `lib/launched-ad-sets/backfill.ts`: phase from the draft's objective. `BackfillEventFacts` still carries the sale dates, which `scripts/backfill-launched-ad-sets.mjs` fills in; they are unused now.
- `lib/learning/joins.ts`: stage precedence is `phase_at_launch` → event sale dates → `objective` → `adset_objective` → `unknown`, and `STAGE_SOURCES` is in that order.
  - `objective` is now the ad's own result type only. Its `launched_ad_sets.objective` lookup and `objectiveStage` are removed, because the objective reaches stage through `phase_at_launch`.
  - Note the change: `traffic` / `awareness` / `engagement` ad sets were not staged by objective before, and are now `on_sale` → `ticket_sale`.
- `lib/learning/runner.ts`, `scripts/learning-refresh.mts`: stage-source columns in the new order.
- `lib/analysis/interest-performance.ts`: `presale` counts as a registration phase alongside `signup` / `registration`.
- `CLAUDE.md`: the `ENABLE_LEARNING_REFRESH` paragraph gives the new order. Migration 186's comments do not state the order, so 186 is unchanged.

## Data

Prod `launched_ad_sets` was corrected by SQL on 2026-10-08: every row with an objective now matches the rule. **No migration ships for it.**

The dry run's read confirms it: 498 rows for active clients, 0 with a null phase.

## Dry run against prod (2026-10-08, read-only, nothing written)

| Client | phase_at_launch | event_dates | objective | adset_objective | unknown | Unknown spend £ | Total £ | Share |
|---|---|---|---|---|---|---|---|---|
| Electric Brixton | 3,964 | 12,447 | 372 | 93 | 221 | 609.29 | 26,390.36 | 2.3% |
| IRONWORKS | 1,044 | 0 | 5,554 | 2,578 | 1,878 | 9,110.76 | 55,529.71 | 16.4% |
| Louder / Parable | 1,708 | 575 | 22 | 21 | 0 | 0 | 4,897.07 | 0.0% |
| Puzzle | 821 | 0 | 158 | 241 | 36 | 32.63 | 1,486.02 | 2.2% |
| Deep House Bible | 1,102 | 76 | 16 | 13 | 7 | 1.22 | 3,168.58 | 0.0% |
| Innellea | 32 | 0 | 0 | 0 | 0 | 0 | 55.09 | 0.0% |

- **Ad-days the phase doesn't stage.** Every ad-day not staged by `phase_at_launch` is in an ad set the app never launched: Electric 13,133, IRONWORKS 10,010, Parable 618, Puzzle 435, DHB 112. No launched ad set with a null phase is left.
- **IRONWORKS and Electric** are still mostly staged by event dates or result types, because most of their ad sets were launched outside the app.
- **Unknown spend.** IRONWORKS is £9,110.76 (16.4%). Puzzle fell from £699 (49.5%) to £32.63 (2.2%).
- **Prod moved between runs.** It had another day of ingest since the #1032 dry run (Electric 16,748 → 17,097 ad-days), so ad-day counts are not directly comparable.

## Validation

- [x] `npm test`: 6,902 node tests pass, 0 fail; vitest 8/8
- [x] `npx eslint` on touched files
- [x] `npx tsc --noEmit`: no new errors. `lib/launched-ad-sets/__tests__/backfill.test.ts` has the same 10 `LaunchSummary` errors as `main`.
