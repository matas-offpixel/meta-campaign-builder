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
  - Stage: before general sale (presale when there is no general-sale date) is `registration`, on or after it is `ticket_sale`. With no dates, the stage comes from `phase_at_launch` (`presale` / `waiting_list` → registration, `on_sale` → ticket_sale), else `unknown`.
  - Result: registrations, purchases, or none for `unknown`.
  - Join rate per client.
- `lib/learning/shrink.ts`:
  - `shrunk = (n·index + k·pool)/(n + k)` with n = funded ads and k = 10; the choice of k is documented in the file header.
  - Pool chain: client → vertical → all (when the vertical row is thin) → 1.
  - Confidence: thin uses the #1026 constants; strong is ≥ 10 funded ads and ≥ £500.
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

## Decisions the brief left open

1. **Currency.** `ad_daily_insights.spend` is in the account currency, and only 3 of the 8 accounts with ad-days are in `bm_ad_accounts`. The fallback is the account → currency map and the GBP rates read on 2026-10-06 (`docs/analysis/interest-performance-2026-10-06.json`: DHB USD 0.753239, Innellea EUR 0.848824). An account in neither is treated as GBP and listed by the dry run. None are today.
2. **`baseline_cpr`** is the lower median per-ad CPR over *funded* tagged ads in the scope and stage. An ad with no result counts as the worst, and the baseline is null when that median has no result. Because each tag's CPR is pooled while the baseline is a per-ad median, indices tend to sit below 1. The ranking within a scope is unaffected.
3. **`all` rows shrink toward 1**, the scope's own norm.
4. **`n_effective` = funded ads + min(k, the pool's funded ads).**
5. **`client_funnel_benchmarks.confidence` is `numeric` (158).** Labels are stored as thin 0 / ok 0.5 / strong 1 and read back by `confidenceLabel`.
6. **`lpv_to_purchase` uses ticket-sale ad-days only.** Registration landing-page views land on signup pages. A rate above 1 is skipped, not clamped (158 checks ≤ 1).
7. **`creative_scores.significance` is boolean (061).** It is true when the creative's funded ads and spend clear the thin rule; the count itself is not stored. There is one snapshot per UTC day (`fetched_at` = that day's midnight), so history is kept.
8. **Ad-days with no resolved client** count in no scope, including `all`.

## Dry run against prod (2026-10-07, read-only, nothing written)

- Run time: 12 s.
- 45,220 ad-days in total. 32,342 are joined to an active client, 12,878 have no client, and none belong to an archived client.

| Job | Would write |
|---|---|
| creative_scores | 10,107 rows over 28 events |
| tag_performance | 423 rows (client 189, vertical 117, all 117; thin 75, ok 85, strong 263) |
| client_funnel_benchmarks | 15 rows, 3 skipped (no ticket-sale LPVs: IRONWORKS, Puzzle, Innellea) |
| interest_live_evidence | 36 clusters, 8 with matching ad sets |

| Client | Ad-days | Tagged | Join rate | by meta_ad_id | by name | registration | ticket_sale | unknown |
|---|---|---|---|---|---|---|---|---|
| Electric Brixton | 16,748 | 8,827 | 52.7% | 1,174 | 7,653 | 4,504 | 10,914 | 1,330 |
| IRONWORKS | 10,984 | 7,996 | 72.8% | 494 | 7,502 | 0 | 0 | 10,984 |
| Louder / Parable | 2,280 | 102 | 4.5% | 102 | 0 | 545 | 1,276 | 459 |
| Puzzle | 1,167 | 312 | 26.7% | 0 | 312 | 0 | 0 | 1,167 |
| Deep House Bible | 1,146 | 560 | 48.9% | 130 | 430 | 282 | 408 | 456 |
| Innellea | 17 | 0 | 0.0% | 0 | 0 | 0 | 0 | 17 |

Top tags by shrunk index exist only for Deep House Bible and Electric Brixton, and only for the registration stage. The full tables are in the PR description.

## What the dry run found

- **IRONWORKS and Puzzle are all `unknown` stage.** None of IRONWORKS' 7 events or Puzzle's 2 has a presale or general-sale date. Their ad sets carry no `phase_at_launch`. IRONWORKS' 10,984 ad-days hold 23,605 registrations, and none of them can rank a tag or feed live interest evidence.
- **No ticket-sale index anywhere.** Only 54 of Electric's 205 funded tagged ticket-sale ads have a purchase, and 0 of 24 for DHB. The median per-ad CPR is therefore "no result", and `baseline_cpr` is null.
- **12,878 ad-days have no client.** They are bracketed campaigns whose code matches no event (DHB 3,046 of 3,046; Parable 2,909 of 3,162; IRONWORKS 1,414 of 1,526; NX 1,072 of 2,160), plus campaigns with no code (Puzzle, Electric Sheffield and Bristol, Innellea).
- **Live evidence matches 8 of 36 clusters.** Only launched ad sets carry `interest_ids`. The seed clusters built from IRONWORKS (Publications and others) were measured from Graph targeting, and IRONWORKS has no app-launched registration ad sets with interests.

## Not verified

- Migration 186 is not applied, so no job has written. `--apply` and the cron are untested against the real tables.
- The `updated_at` trigger on `interest_clusters` will bump `updated_at` nightly when `live_evidence` is written.
- The creative_scores write is about 10k single-row upserts at concurrency 12, timed only by estimate.

## Validation

- [x] `npx tsc --noEmit`: no errors in touched files (the baseline has unrelated test-file errors)
- [x] `npm run build` (with git-ignored `scripts/out` moved aside)
- [x] `npm test`: 6,882 node tests pass, 0 fail; vitest 8/8
