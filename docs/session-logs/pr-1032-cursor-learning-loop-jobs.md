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
  - `interest_clusters.evidence_refreshed_at` and `live_evidence`.
  - Unapplied: Matas applies.
- `lib/learning/joins.ts`: the ad-day joins and the service-role loader.
  - Client and event: `resolveAdContext`. An event with no client takes the event's client.
  - Tags: by `meta_ad_id`, else `(event_id, creative_name = ad_name)`.
  - Stage: the first rule that applies, recorded on the fact as `stageSource`:
    1. `event_dates`: before general sale (presale when there is no general-sale date) is `registration`, on or after it is `ticket_sale`.
    2. `phase_at_launch`: `presale` / `waiting_list` → registration, `on_sale` → ticket_sale.
    3. `objective`: the ad set's `launched_ad_sets.objective` (registration / lead → registration, purchase → ticket_sale), else the ad's `result_action_type` (registration / lead pixel types → registration, purchase → ticket_sale).
    4. `unknown`.
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
- **Pooled costs in both stages.** A tag's cpr and `baseline_cpr` are both spend ÷ results, never a median of per-ad costs. This is the rule #1026 adopted for registration.
- **A results floor in confidence.** A row is thin under 10 stage results.
  - Applied to `tag_performance`, interest live evidence (registrations), and the `creative_scores` `convert` axis.
  - Not applied to the funnel benchmarks (rates whose n is impressions) or to the hook, watch and click axes.

My calls where the brief was silent:

1. **Currency.** `ad_daily_insights.spend` is in the account currency, and only 3 of the 8 accounts with ad-days are in `bm_ad_accounts`. The fallback is the account → currency map and the GBP rates read on 2026-10-06 (`docs/analysis/interest-performance-2026-10-06.json`: DHB USD 0.753239, Innellea EUR 0.848824). An account in neither is treated as GBP and listed by the dry run. None are today.
2. **`all` rows shrink toward 1**, the scope's own norm.
3. **`n_effective` = funded ads + min(k, the pool's funded ads).**
4. **`client_funnel_benchmarks.confidence` is `numeric` (158).** Labels are stored as thin 0 / ok 0.5 / strong 1 and read back by `confidenceLabel`.
5. **`lpv_to_purchase` uses ticket-sale ad-days only.** Registration landing-page views land on signup pages. A rate above 1 is skipped, not clamped (158 checks ≤ 1).
6. **`creative_scores.significance` is boolean (061).** It is true when the creative clears the thin rule; the count itself is not stored. There is one snapshot per UTC day (`fetched_at` = that day's midnight), so history is kept.
7. **Ad-days with no resolved client** count in no scope, including `all`.
8. **The baseline is tagged ads only.** `baseline_cpr` is pooled over the scope's *tagged* ads, so the index compares a tag against the ads being ranked.

## Dry run against prod (2026-10-07, read-only, nothing written; after the rulings)

- Run time: 8 s.
- 45,220 ad-days in total. 32,342 are joined to an active client, 12,878 have no client, and none belong to an archived client.

| Job | Would write |
|---|---|
| creative_scores | 10,636 rows over 28 events |
| tag_performance | 516 rows (client 258, vertical 129, all 129; thin 259, ok 32, strong 225) |
| client_funnel_benchmarks | 17 rows, 1 skipped (Innellea `lpv_to_purchase`, no ticket-sale LPVs) |
| interest_live_evidence | 36 clusters, 8 with matching ad sets |

| Client | Ad-days | Tagged | Join rate | by meta_ad_id | by name | registration | ticket_sale | unknown |
|---|---|---|---|---|---|---|---|---|
| Electric Brixton | 16,748 | 8,827 | 52.7% | 1,174 | 7,653 | 5,156 | 11,099 | 493 |
| IRONWORKS | 10,984 | 7,996 | 72.8% | 494 | 7,502 | 5,025 | 1,452 | 4,507 |
| Louder / Parable | 2,280 | 102 | 4.5% | 102 | 0 | 953 | 1,276 | 51 |
| Puzzle | 1,167 | 312 | 26.7% | 0 | 312 | 0 | 170 | 997 |
| Deep House Bible | 1,146 | 560 | 48.9% | 130 | 430 | 660 | 466 | 20 |
| Innellea | 17 | 0 | 0.0% | 0 | 0 | 17 | 0 | 0 |

| Client | Stage from event_dates | phase_at_launch | objective | unknown |
|---|---|---|---|---|
| Electric Brixton | 15,418 | 0 | 837 | 493 |
| IRONWORKS | 0 | 0 | 6,477 | 4,507 |
| Louder / Parable | 1,821 | 0 | 408 | 51 |
| Puzzle | 0 | 0 | 170 | 997 |
| Deep House Bible | 690 | 0 | 436 | 20 |
| Innellea | 0 | 0 | 17 | 0 |

Top tags now exist for DHB, IRONWORKS and Electric (registration), and for Parable, IRONWORKS and Electric (ticket sale). The full tables are in the PR description.

## What the dry run found

- **Stage still unknown for about a quarter of IRONWORKS' spend.** £13,171 of £55,122 (23.9%) is still `unknown`, and 72% of Puzzle's £1,411.
  - These are ads that never logged a result.
  - Taking the stage from the ad set's other ads would recover about £3,888 of IRONWORKS' unknown spend and £318 of Puzzle's.
  - The rest (IRONWORKS £9,282) is in ad sets where no ad logged a result, which are likely traffic or awareness campaigns.
  - Not built: it needs a ruling.
- **12,878 ad-days have no client.** They are bracketed campaigns whose code matches no event (DHB 3,046 of 3,046; Parable 2,909 of 3,162; IRONWORKS 1,414 of 1,526; NX 1,072 of 2,160), plus campaigns with no code (Puzzle, Electric Sheffield and Bristol, Innellea).
- **Live evidence matches 8 of 36 clusters.** Only launched ad sets carry `interest_ids`. The seed clusters built from IRONWORKS (Publications and others) were measured from Graph targeting.

## Not verified

- Migration 186 is not applied, so no job has written. `--apply` and the cron are untested against the real tables.
- The `updated_at` trigger on `interest_clusters` will bump `updated_at` nightly when `live_evidence` is written.
- The creative_scores write is about 10k single-row upserts at concurrency 12, timed only by estimate.

## Validation

- [x] `npx tsc --noEmit`: no errors in touched files (the baseline has unrelated test-file errors)
- [x] `npm run build` (with git-ignored `scripts/out` moved aside)
- [x] `npm test`: 6,888 node tests pass, 0 fail; vitest 8/8
