# Learning loop B — learning jobs

## PR

- **Number:** 1032
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1032
- **Branch:** `cursor/learning-loop-jobs`

## Summary

A nightly, DB-only job (`/api/cron/learning-refresh`, 03:30 UTC, `ENABLE_LEARNING_REFRESH=1`) turns `ad_daily_insights`, `launched_ads`, `launched_ad_sets` and `creative_tag_assignments` into stored learnings, each with an n and a confidence. It makes zero Meta calls. There are four jobs, and each logs its rows and fails alone:
- `creative_scores`
- `tag_performance` (new, migration 186)
- `client_funnel_benchmarks`
- `interest_clusters.live_evidence`

`lib/learning/read.ts` is the read side for PR C (dashboard) and PR D (wizard). Archived clients are excluded through `lib/db/client-status.ts`. No UI.

## Scope / files

- `supabase/migrations/186_tag_performance.sql`:
  - `tag_performance`, unique on `(scope, scope_id, dimension, value_key, stage, window_days)`.
  - RLS: read by the operator who owns the client (or any client in the pooled scope); writes are service-role only. `client_users` read nothing.
  - `interest_clusters.evidence_refreshed_at` and `live_evidence`. The `live_evidence` comment notes that the nightly write bumps `updated_at` through the 181 trigger.
  - `creative_scores`: drops 061's `(event_id, creative_name, axis, fetched_at)` unique and adds `creative_scores_event_creative_axis_key (event_id, creative_name, axis)`. Duplicate keys are collapsed to the latest `fetched_at` first. Prod held 0 rows on 7 Oct.
  - Unapplied: Matas applies.
- `lib/learning/joins.ts`: the ad-day joins and the service-role loader.
  - Client and event: `resolveAdContext`. An event with no client takes the event's client.
  - Tags: by `meta_ad_id`, else `(event_id, creative_name = ad_name)`.
  - Stage: the first rule that applies, recorded on the fact as `stageSource`:
    1. `event_dates`: before general sale (presale when there is no general-sale date) is `registration`, on or after it is `ticket_sale`.
    2. `phase_at_launch`: `presale` / `waiting_list` → registration, `on_sale` → ticket_sale.
    3. `objective`: the ad set's `launched_ad_sets.objective` (registration / lead → registration, purchase → ticket_sale), else the ad's `result_action_type` (registration / lead pixel types → registration, purchase → ticket_sale).
    4. `adset_objective`: an ad with no result day takes the stage most of its ad set's result days carry. It is recorded apart from rule 3, so the dry run shows how much rests on the fallback.
    5. `unknown`.
  - Campaign names are never read for stage.
  - Result: registrations, purchases, or none for `unknown`.
  - Join rate per client.
- `lib/learning/shrink.ts`:
  - `shrunk = (n·index + k·pool)/(n + k)` with n = funded ads and k = 10; the choice of k is documented in the file header.
  - Pool chain: client → vertical → all (when the vertical row is thin) → 1.
  - Confidence:
    - Thin uses the #1026 constants (ads and spend). A row is also thin when its ads have fewer than 10 stage results (`THIN_MIN_RESULTS`): purchases in ticket_sale, registrations in registration. The results floor is documented in the file header.
    - Strong is ≥ 10 funded ads and ≥ £500.
- `lib/learning/currency.ts`: GBP conversion. See Decisions.
- `lib/learning/tag-performance.ts`, `creative-scores.ts`, `funnel-benchmarks.ts`, `interest-evidence.ts`: pure compute plus one writer each.
- `lib/learning/runner.ts`: killswitch, the operator lookup (same email as migration 182), job isolation, dry run.
- `lib/learning/read.ts`: `getClientLearnings`, `getTagPerformance`, `getCreativeScores`.
- `app/api/cron/learning-refresh/route.ts`, `vercel.json` (`30 3 * * *`), `lib/reporting/cron-health-monitor.ts` (`tag_performance.computed_at`, 26 h), `CLAUDE.md`.
- `scripts/learning-refresh.mts`: `--dry-run` | `--apply`.
- Reused, not reimplemented:
  - `resolveAdContext` / `loadAdContextIndex`
  - `clusterKey`, `clientBaselineCpr` and `fundedAdSetCount`
  - `THIN_MIN_AD_SETS`, `THIN_MIN_SPEND_GBP` and `THIN_MIN_AD_SET_SPEND_GBP`
  - `upsertCreativeScore`
  - `resolveClientFunnelBenchmarks`
  - `loadArchivedClientIds` / `dropArchivedClientRows`

## Decisions

Rulings from Matas after the first dry run:

- **Stage fallback** is the objective, not campaign-name keywords.
  - It comes after event dates and `phase_at_launch`: the ad set's `launched_ad_sets.objective` first, else the ad's `result_action_type`.
  - The result type is read per ad, not per ad-day: the stage most of the ad's result days carry, with no stage on a tie. Read per ad-day, an ad's days with no result would stay `unknown`, their spend would drop out, and the stage's cost would look cheaper than it was.
  - An ad with no result day then takes its ad set's result stage (`adset_objective`). An ad set has one optimisation goal, so its other ads' result type is the ad set's objective.
- **Pooled costs in both stages.** A tag's cpr and `baseline_cpr` are both spend ÷ results, never a median of per-ad costs. This is the rule #1026 adopted for registration.
- **A results floor in confidence.** A row is thin under 10 stage results.
  - Applied to `tag_performance`, interest live evidence (registrations), and the `creative_scores` `convert` axis.
  - Not applied to the funnel benchmarks (rates whose n is impressions) or to the hook, watch and click axes.

My calls where the brief was silent:

1. **Currency.** `ad_daily_insights.spend` is in the account currency, and only 3 of the 8 accounts with ad-days are in `bm_ad_accounts`. The fallback is the account → currency map in `lib/learning/currency.ts`, from `docs/analysis/interest-performance-2026-10-06.json`.
   - Three accounts in that map are not GBP:
     - `968594768066330` DHB, USD;
     - `713771672906815` Innellea, EUR;
     - `759664074876110` Innervisions GmbH, EUR (no ad-days today).
   - The GBP rates are hardcoded: ECB reference via frankfurter.app on 2026-10-06 (EUR 0.848824, USD 0.753239). Refreshing them is a maintenance step, not a bug.
   - An account in neither `bm_ad_accounts` nor the map is treated as GBP and listed by the dry run. None are today.
2. **`all` rows shrink toward 1**, the scope's own norm.
3. **`n_effective` = funded ads + min(k, the pool's funded ads).**
4. **`client_funnel_benchmarks.confidence` is `numeric` (158).** Labels are stored as thin 0 / ok 0.5 / strong 1 and read back by `confidenceLabel`.
5. **`lpv_to_purchase` uses ticket-sale ad-days only.** Registration landing-page views land on signup pages. A rate above 1 is skipped, not clamped (158 checks ≤ 1).
6. **`creative_scores.significance` is boolean (061).** It is true when the creative clears the thin rule; the count itself is not stored. Since round 2 there is one row per `(event_id, creative_name, axis)`, restated nightly with `fetched_at` = the run, in batched upserts of 500 (about 22 calls for ~10.9k rows). `getCreativeScores` reads the latest run's rows.
7. **Ad-days with no resolved client** count in no scope, including `all`.
8. **The baseline is tagged ads only.** `baseline_cpr` is pooled over the scope's *tagged* ads, so the index compares a tag against the ads being ranked.

## Dry run against prod (2026-10-07, read-only, nothing written; after the rulings and the ad-set fallback)

- Run time: 10 s.
- 45,220 ad-days in total. 32,342 are joined to an active client, 12,878 have no client, and none belong to an archived client.

| Job | Would write |
|---|---|
| creative_scores | 10,903 rows over 28 events |
| tag_performance | 506 rows (client 256, vertical 125, all 125; thin 248, ok 30, strong 228) |
| client_funnel_benchmarks | 17 rows, 1 skipped (Innellea `lpv_to_purchase`, no ticket-sale LPVs) |
| interest_live_evidence | 36 clusters, 8 with matching ad sets |

| Client | Ad-days | Tagged | Join rate | by meta_ad_id | by name | registration | ticket_sale | unknown |
|---|---|---|---|---|---|---|---|---|
| Electric Brixton | 16,748 | 8,827 | 52.7% | 1,174 | 7,653 | 5,248 | 11,197 | 303 |
| IRONWORKS | 10,984 | 7,996 | 72.8% | 494 | 7,502 | 6,866 | 2,182 | 1,936 |
| Louder / Parable | 2,280 | 102 | 4.5% | 102 | 0 | 974 | 1,276 | 30 |
| Puzzle | 1,167 | 312 | 26.7% | 0 | 312 | 0 | 487 | 680 |
| Deep House Bible | 1,146 | 560 | 48.9% | 130 | 430 | 660 | 479 | 7 |
| Innellea | 17 | 0 | 0.0% | 0 | 0 | 17 | 0 | 0 |

Ad-days by where the stage came from, and the spend left `unknown`:

| Client | event_dates | phase_at_launch | objective | adset_objective | unknown | Unknown spend £ | Total £ | Share |
|---|---|---|---|---|---|---|---|---|
| Electric Brixton | 15,418 | 0 | 837 | 190 | 303 | 644.78 | 25,672.93 | 2.5% |
| IRONWORKS | 0 | 0 | 6,477 | 2,571 | 1,936 | 9,282.06 | 55,122.27 | 16.8% |
| Louder / Parable | 1,821 | 0 | 408 | 21 | 30 | 24.73 | 4,819.96 | 0.5% |
| Puzzle | 0 | 0 | 170 | 317 | 680 | 699.04 | 1,411.44 | 49.5% |
| Deep House Bible | 690 | 0 | 436 | 13 | 7 | 1.22 | 3,120.83 | 0.0% |
| Innellea | 0 | 0 | 17 | 0 | 0 | 0 | 14.55 | 0.0% |

Top tags exist for DHB, IRONWORKS and Electric (registration), and for Parable, IRONWORKS and Electric (ticket sale). The full tables are in the PR description.

## What the dry run found

- **Spend still `unknown`.** It is in ad sets where no ad logged a result: IRONWORKS £9,282 (16.8%), Puzzle £699 (49.5%). These are likely traffic or awareness campaigns, so they stay unknown.
- **12,878 ad-days have no client.** They are bracketed campaigns whose code matches no event (DHB 3,046 of 3,046; Parable 2,909 of 3,162; IRONWORKS 1,414 of 1,526; NX 1,072 of 2,160), plus campaigns with no code (Puzzle, Electric Sheffield and Bristol, Innellea).
- **Live evidence matches 8 of 36 clusters.** Only launched ad sets carry `interest_ids`. The seed clusters built from IRONWORKS (Publications and others) were measured from Graph targeting.

## Not verified

- Migration 186 is not applied, so no job has written. `--apply` and the cron are untested against the real tables.
- The `updated_at` trigger on `interest_clusters` will bump `updated_at` nightly when `live_evidence` is written. This is by design and documented on the column.
- The `creative_scores` write time is unmeasured. There is no non-prod target: no local Supabase or Docker, and `.env.local` is prod. `--apply` was not run.
- Rows for creatives that drop out of the facts (an archived client, an ad renamed) are not deleted from `creative_scores`; `getCreativeScores` hides them by reading only the latest `fetched_at`.

## Round 2 (review should-fixes)

1. `writeTagPerformance` returns `{written: 0, deleted: 0}` on an empty run and logs `tag_performance: no rows, delete skipped`. Before, an empty run upserted nothing and then deleted the whole window.
2. `creative_scores` is one row per creative × axis, restated nightly and batched in upserts of 500 (migration 186 swaps the unique key). `upsertCreativeScore` uses the new key (`CREATIVE_SCORE_CONFLICT`).
3. Migration 186 comments:
   - `baseline_cpr` is pooled spend ÷ results in both stages.
   - `confidence` includes the 10-result floor.
   - `live_evidence` notes the 181 `updated_at` trigger.
4. The CLAUDE.md stage precedence reads: event sale dates → `phase_at_launch` → `objective` → `adset_objective` (majority of the ad set's result days) → `unknown`.

## Validation

- [x] `npx tsc --noEmit`: no errors in touched files (the baseline has unrelated test-file errors)
- [x] `npm run build` (with git-ignored `scripts/out` moved aside)
- [x] `npm test`: 6,893 node tests pass, 0 fail; vitest 8/8
