# Campaign objective on ad_daily_insights

## PR

- **Number:** 1034
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1034
- **Branch:** `cursor/insights-campaign-objective`

## Summary

Every ad-day is now staged by Matas's objective rule, including ad sets the app never launched. `ad_daily_insights` gains `campaign_objective`, `optimization_goal` and `promoted_event` (migration 187).
- The nightly cron requests the first two on the insights row.
- It reads `promoted_event` from the ad set only where the stage needs it.
- A new `meta_objective` rung sits between `phase_at_launch` and event dates.

On the dry run, IRONWORKS' unknown spend falls from £9,110.76 (16.4%) to £0, and every active client's unknown spend is £0.

## For Matas to rule on

1. **Leads → presale.** `OUTCOME_LEADS` / `LEAD_GENERATION` campaigns, a `LEAD_GENERATION` goal and a `LEAD` promoted event all count as presale, the same as Complete Registration. This is an extension of your rule, not part of it. Overrule it in `phaseFromMetaObjective` (`lib/launched-ad-sets/snapshot.ts`).
   - What it covers: 456 ad sets are `OUTCOME_LEADS` optimising for `COMPLETE_REGISTRATION` (presale either way), 12 are `OUTCOME_LEADS | LANDING_PAGE_VIEWS` and 9 are `OUTCOME_LEADS | LEAD_GENERATION`.
2. **`OUTCOME_SALES | OFFSITE_CONVERSIONS | OTHER`** (2 ad sets) counts as on_sale, through `mapMetaObjectiveToInternal`'s default to purchase.
3. **Stage flips against #1033**, on ad-days that are now `meta_objective`:
   - **IRONWORKS registration → ticket_sale:**
     - 509 ad-days (£4,845.33) whose own result days were registrations;
     - 953 ad-days (£2,403.63) that took their ad set's registrations.

     Meta says these ad sets are not Complete Registration or leads, so the rule puts them on sale.
   - **Electric ticket_sale → registration:** 881 ad-days (£1,050.14) the event dates put after general sale, which run in Complete Registration ad sets.

## Scope / files

- **`supabase/migrations/187_ad_daily_insights_objective.sql`:** three nullable text columns with comments, and a partial index on `(ad_account_id, meta_adset_id) where promoted_event is null`. Matas applies it.
- **`lib/launched-ad-sets/snapshot.ts`:**
  - `phaseFromMetaObjective({campaignObjective, optimizationGoal, promotedEvent})` reuses `mapMetaObjectiveToInternal` and `phaseAtLaunchFromObjective`.
  - It returns null for an unknown objective, and for a sales-family conversion ad set whose promoted event isn't known yet.
  - `metaObjectiveNeedsPromotedEvent` says which ad sets need the event read.
- **`lib/ad-daily-insights/derive.ts`:** requests `objective` and `optimization_goal`; derive copies them to `campaign_objective` / `optimization_goal`.
- **`lib/ad-daily-insights/adset-meta.ts`** (new):
  - `fetchAdSetMeta` makes one batched `GET /?ids=…` per ≤50 ad sets, one attempt each.
  - `createPromotedEventLookup` is the per-run map. It reads non-null `promoted_event` already on the table first, then asks Meta only for the rest.
- **`lib/ad-daily-insights/runner.ts`:**
  - Fills `promoted_event` on every upserted row, so the upsert never nulls a known value.
  - Counts the ad set calls in `meta_calls` and `outcome.calls`, and reports `adsetCalls` / `adsetError`.
  - A failed ad set read leaves the rows null, still writes them, and stops further ad set reads for the run.
  - The cron and `scripts/backfill-ad-daily-insights.mts` share this path.
- **Narrower than the spec:** the nightly lookup only asks about sales-family conversion ad sets (`OUTCOME_SALES` / `CONVERSIONS` with `OFFSITE_CONVERSIONS`, `VALUE` or no goal).
  - Every other ad set is staged from objective and goal alone, and has no promoted event to store.
  - In the probe, none of the 21 non-conversion ad sets returned a `promoted_object`.
  - Without the filter those ad sets would be re-read every night, so the steady state would not be about 0 calls.
- **`lib/ad-daily-insights/objective-backfill.ts`** (new) and **`scripts/backfill-insights-objective.mts`** (new):
  - Per active-client account, they take the distinct ad sets missing `campaign_objective`, or missing `promoted_event` where it's needed.
  - The read is `campaign{objective},optimization_goal,promoted_object`, followed by one UPDATE per ad set by `meta_adset_id`.
  - Modes: the default plans only (zero Meta calls, zero writes); `--fetch` reads Meta and saves a snapshot without writing; `--apply` writes and needs migration 187.
  - A rate-limit or auth code stops the run; any other failed batch is skipped.
- **`lib/learning/joins.ts`:**
  - `StageSource` / `STAGE_SOURCES` gain `meta_objective`, second in the order.
  - `metaPhaseByAdSet` builds one phase per ad set, and `stageOf` takes `metaPhase` as its fourth argument.
  - The loader selects the 187 columns. Its `adSetMeta` option (dry runs only) stages from a snapshot instead and doesn't read them.
- **`lib/learning/runner.ts`:** stage-source counts come from `STAGE_SOURCES`; the `load` option is passed through.
- **`scripts/learning-refresh.mts`:** the table columns come from `STAGE_SOURCES`; `--adset-meta <file>` works with `--dry-run` only.
- **`CLAUDE.md`:** the `ENABLE_AD_DAILY_INSIGHTS` paragraph (new fields, ad set read, objective backfill), the `ENABLE_LEARNING_REFRESH` precedence, and the latest migration.

## Rollout

Migration 187 has to be applied before merge. Until then, the cron's upsert and the learning loader would both reference columns that don't exist.

Then run `scripts/backfill-insights-objective.mts --apply`: 32 calls at today's ad set count.

## Backfill call count

Measured on prod, 2026-10-08. Before migration 187, every ad set counts as missing.

| Account | Ad sets | Calls |
|---|---|---|
| act_1058599195559790 | 65 | 2 |
| act_1073273492854557 | 143 | 3 |
| act_1129797095984755 | 186 | 4 |
| act_1967530076312 (IRONWORKS) | 382 | 8 |
| act_2011069725849568 | 50 | 1 |
| act_606252931141334 | 488 | 10 |
| act_713771672906815 | 14 | 1 |
| act_968594768066330 | 127 | 3 |
| **Total** | **1,455** | **32** |

**`--fetch` run, 2026-10-08:**
- 32 Meta calls, 0 failed batches, 1,455 ad sets read, 0 writes.
- About 85 s, with 2 s between calls.

What came back (objective | optimization_goal | promoted_event, counted in ad sets):

```
OUTCOME_LEADS | OFFSITE_CONVERSIONS | COMPLETE_REGISTRATION: 456
OUTCOME_SALES | OFFSITE_CONVERSIONS | COMPLETE_REGISTRATION: 270
OUTCOME_TRAFFIC | LANDING_PAGE_VIEWS | -: 185
OUTCOME_SALES | OFFSITE_CONVERSIONS | PURCHASE: 124
OUTCOME_SALES | OFFSITE_CONVERSIONS | INITIATED_CHECKOUT: 100
OUTCOME_TRAFFIC | LINK_CLICKS | -: 95
OUTCOME_SALES | LANDING_PAGE_VIEWS | -: 70
OUTCOME_ENGAGEMENT | POST_ENGAGEMENT | -: 59
OUTCOME_SALES | LINK_CLICKS | -: 39
OUTCOME_AWARENESS | REACH | -: 26
OUTCOME_LEADS | LANDING_PAGE_VIEWS | -: 12
OUTCOME_LEADS | LEAD_GENERATION | -: 9
OUTCOME_SALES | VALUE | PURCHASE: 2
OUTCOME_ENGAGEMENT | LINK_CLICKS | -: 2
OUTCOME_SALES | OFFSITE_CONVERSIONS | OTHER: 2
LINK_CLICKS | LINK_CLICKS | -: 1
OUTCOME_SALES | OFFSITE_CONVERSIONS | -: 1
OUTCOME_TRAFFIC | PROFILE_VISIT | -: 1
OUTCOME_ENGAGEMENT | THRUPLAY | -: 1
```

The full backfill does observe `COMPLETE_REGISTRATION` (726 ad sets), which the 1-day probe never saw.

In the nightly steady state, a run costs one extra call per 50 sales conversion ad sets that are new that day.

## Dry run after a dry backfill (2026-10-08, read-only, nothing written)

`learning-refresh.mts --dry-run --adset-meta scripts/out/insights-objective-adsets.json`:

| Client | phase_at_launch | meta_objective | event_dates | objective | adset_objective | unknown | Unknown spend £ | Total £ | Share |
|---|---|---|---|---|---|---|---|---|---|
| Electric Brixton | 3,964 | 13,133 | 0 | 0 | 0 | 0 | 0 | 26,390.36 | 0.0% |
| IRONWORKS | 1,044 | 10,010 | 0 | 0 | 0 | 0 | 0 | 55,529.71 | 0.0% |
| Louder / Parable | 1,708 | 618 | 0 | 0 | 0 | 0 | 0 | 4,897.07 | 0.0% |
| Puzzle | 821 | 435 | 0 | 0 | 0 | 0 | 0 | 1,486.02 | 0.0% |
| Deep House Bible | 1,102 | 112 | 0 | 0 | 0 | 0 | 0 | 3,168.58 | 0.0% |
| Innellea | 32 | 0 | 0 | 0 | 0 | 0 | 0 | 55.09 | 0.0% |

Stages: Electric 7,226 registration / 9,871 ticket_sale; IRONWORKS 5,459 / 5,595; Parable 1,401 / 925; Puzzle 0 / 1,256; DHB 678 / 536; Innellea 32 / 0.

- IRONWORKS unknown: £9,110.76 (16.4%) → £0.
- Puzzle unknown: £32.63 → £0.
- Electric unknown: £609.29 → £0.
- Jobs would write: creative_scores 11,158; tag_performance 374; client_funnel_benchmarks 17; interest_live_evidence 36.

## Round 2 (2026-10-08)

Migration 187 was applied in prod on 2026-10-08. Its SQL is unchanged.

1. **Scope.** The first commit swept in 161 untracked `docs/session-logs/*` files with `git add docs/session-logs`. They are untracked again (`git rm --cached`) and still on disk. The PR is the 16 code/config files, plus this log and the `lib/meta/campaign.ts` export.
2. **NULL-out fixed.** postgrest-js 2.99.3's `upsert` sends `columns=` as the union of every row's keys, so a row missing a key in a mixed batch wrote NULL. The fixes:
   - `deriveAdDailyInsight` sets `campaign_objective` / `optimization_goal` only when the insights row has them, and never sets `promoted_event`.
   - The runner sets `promoted_event` only when it is known this run.
   - `upsertBatches` splits each span by exact key set, so a column a row can't fill is not in its batch.
3. **Stored read** (`readStoredPromotedEvents`):
   - Never capped: each page drops the ad sets already found and asks again for the rest, so every page finds at least one new ad set. One ad set with thousands of ad-days can't push another out.
   - A read error is logged and leaves those ids unknown (left out of the upsert, Meta not asked) rather than null.
   - Meta answering "no promoted event" is unknown too, so a backfilled value on a non-sales ad set survives.
4. **Notes folded in:**
   - The `--apply` UPDATE also filters `.eq("ad_account_id", account)`.
   - `--account` goes through `backfillAccounts`, which refuses an archived client's account or one no client uses.
   - `snapshot.ts` imports `SALES_FAMILY` from `lib/meta/campaign.ts`, now exported, instead of a copy.
5. **New tests** (`lib/ad-daily-insights/__tests__/adset-meta.test.ts`). They run against a fake store that applies the union-of-keys column list, and they fail if every row is put back into one batch.
   - A stored PURCHASE survives a run where the stored read fails and Meta would rate-limit.
   - A stored COMPLETE_REGISTRATION survives Meta reads stopped mid-run.
   - A non-sales ad set's stored event survives its nightly upsert, in the same span as a sales row with an event.
   - `upsertBatches` never mixes key sets.
   - The stored read returns every ad set past 1,000 rows: 1,500 rows for one ad set plus another, in 2 queries.
   - `--account` refuses archived and unknown accounts.
   - The `--apply` UPDATE filters by ad account.
6. **`--fetch` re-run** (migration 187 applied, nothing filled yet): 32 calls planned, 32 made, 0 failed batches, 1,455 ad sets read, 0 writes. `--account act_999999999` is refused.

## Validation

- [x] `npm test`: 6,956 node tests, 6,952 pass, 0 fail (the rest skipped or todo); vitest 8/8 (round 2)
- [x] `npx eslint` on touched files
- [x] `npx tsc --noEmit`: no new errors. The only errors in touched files are the 10 `LaunchSummary` errors in `lib/launched-ad-sets/__tests__/backfill.test.ts`, as on `main`.
- [x] `npm run build`
- [x] `frames:check`: passes in CI on this PR. It fails locally on L3-768 (1.7%) and J2-768 (100%), from the local environment; no UI is touched.

## Probe (2026-10-08, read-only, 3 Graph calls, IRONWORKS `act_1967530076312`)

Script: `scripts/out/probe-insights-objective.mts` (git-ignored). Token never printed. Same `insightsParams` as the cron, plus `objective,optimization_goal` on the fields string.

**Call 1.** `GET /act_1967530076312/insights`, `level=ad`, `time_increment=1`, 2026-10-05..2026-10-07, `limit=500`:

```
INSIGHTS CALL FAILED: Please reduce the amount of data you're asking for, then retry your request {"error":"Please reduce the amount of data you're asking for, then retry your request","code":1}
```

This is IRONWORKS' known multi-day failure, the one the cron's adaptive window splits to 1 day. Neither field was rejected.

**Call 2.** The same request for 2026-10-07 only, `limit=100`:

```
insights: 100 rows, more pages: false, window 2026-10-07..2026-10-07
objective: {"OUTCOME_AWARENESS":17,"OUTCOME_SALES":62,"LINK_CLICKS":13,"OUTCOME_ENGAGEMENT":8}
optimization_goal: {"REACH":17,"OFFSITE_CONVERSIONS":62,"LINK_CLICKS":3,"POST_ENGAGEMENT":8,"LANDING_PAGE_VIEWS":10}
objective | optimization_goal: {"OUTCOME_AWARENESS | REACH":17,"OUTCOME_SALES | OFFSITE_CONVERSIONS":62,"LINK_CLICKS | LINK_CLICKS":3,"OUTCOME_ENGAGEMENT | POST_ENGAGEMENT":8,"LINK_CLICKS | LANDING_PAGE_VIEWS":10}
row keys: ["actions","ad_id","ad_name","adset_id","adset_name","campaign_id","campaign_name","clicks","date_start","date_stop","impressions","inline_link_clicks","objective","optimization_goal","reach","spend","video_15_sec_watched_actions","video_p100_watched_actions"]
distinct adset ids: 37
```

- Both fields are accepted at `level=ad`, and every row carried a value: no nulls, none absent.
- `objective` is the campaign objective. It includes a legacy value, `LINK_CLICKS`.

**Call 3.** One batched `GET /?ids=<37 adset ids>&fields=promoted_object,optimization_goal`:

```
adset batch: asked 37, got 37
campaign objective | adset optimization_goal | promoted_object.custom_event_type (ad sets): {
 "OUTCOME_AWARENESS | REACH | <no promoted_object>": 6,
 "OUTCOME_SALES | OFFSITE_CONVERSIONS | PURCHASE": 16,
 "LINK_CLICKS | LINK_CLICKS | <no promoted_object>": 2,
 "OUTCOME_ENGAGEMENT | POST_ENGAGEMENT | <no promoted_object>": 8,
 "LINK_CLICKS | LANDING_PAGE_VIEWS | <no promoted_object>": 5
}
promoted_object keys seen: {"pixel_id":16,"custom_event_type":16,"smart_pse_enabled":16}
calls 3
```

**Can the insights row tell Complete Registration from Purchase under `OUTCOME_SALES`?**
- No. `optimization_goal` is `OFFSITE_CONVERSIONS` for both by Meta's design, and the row has no event field.
- The ad set's `promoted_object.custom_event_type` carries the event; here it was `PURCHASE` on all 16 conversion ad sets.
- Not observed: IRONWORKS ran no `COMPLETE_REGISTRATION` ad set on 2026-10-07, so this probe never saw that value come back. The mapping for it rests on Meta's documented enum and on the `promoted_object` read proven here.
- Ad sets with no conversion goal return no `promoted_object` at all.
