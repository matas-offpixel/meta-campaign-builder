# Plan v2 — audit two: data readiness

**Date:** 2026-09-05 · **Branch:** `cc/plan-v2-audit-two` · **Mode:** read-only. No migration applied, no code changed, one document written.
**Reads:** `docs/CAMPAIGN_PLAN_V2_CANON_2026-09-05.md` §1.2, §1.3, §1.5, §6 G4–G6, G20 · migrations 039, 060, 061, 099, 155, 157, 158, 159, 161, 165 · `lib/dashboard/event-funnel.ts` · `lib/db/event-history-collapse.ts` · `lib/plan/target-unit.ts` · `lib/db/creative-tags.ts` · `lib/reporting/creative-tag-breakdowns.ts` · `lib/dashboard/cron-eligibility.ts` · `vercel.json`.
**Production:** project `zbtldbfjbhfvpksmdvnt`, read-only SQL via the Supabase MCP on 2026-09-05. Every count below is from that session. The client the brief calls "Electric Group" is the `clients` row named **Electric Brixton** (`f9045034-2788-4b1d-94d1-1a5ab7fa5ac8`); "NX" is `events.venue_name = 'NX Newcastle'`.

---

## 0 · The table

| # | Thing the canon needs | Have | Need migration | Need view | Need code |
|---|---|---|---|---|---|
| 1 | Benchmark: median + IQR of cost-per-result per client × venue × unit (§1.2) | **Yes, on read.** One client × venue: 3.7 ms, 182 buffers. Whole tenant: 240 ms, 176 groups. Electric Brixton × NX × signup reproduces the canon exactly: n = 5, median £2.03, IQR £1.46–£2.12. | No. | **Yes** — `campaign_plan_benchmarks_v` (the query in §1, as a view) so the read path, the `ⓘ`, and the removal-condition test all read one definition. A materialised table is not earned at 26,241 rollup rows. | Read path + unit→column map + the §1.5 alarm test. |
| 2 | Venue key for "at this venue" | **No.** `events.venue_id` is null on all 126 events with spend; the only key is free-text `venue_name`. 4theFans alone spells one venue three ways (§6 item 1). | **Yes** — 167: backfill `events.venue_id` from `venues` (or a `venue_key`), per client. | — | Venue normaliser + a test that fails on a duplicate spelling with spend. |
| 3 | Prediction row (§1.3) | **No table.** | **Yes** — 166 `campaign_plan_predictions` (§2). | — | Write at launch; write `actual` at close. |
| 4 | "Plan-window days only" (G20) | Partly. `campaign_plans.start_date / end_date` (157) and `start_time / end_time` (159) exist. DOD's stored window is one day, 46 minutes long. | No (optionally a CHECK that a launched plan's window is ≥ 1 day). | — | Window resolver in the rollup runner + the archive action (§2.3). |
| 5 | Per-platform result columns for the split's history outline (§1.5 rule 2) | **Yes — and populated.** `tiktok_results` > 0 on 213 days / 985 results across 6 events; `google_ads_conversions` > 0 on 4 days / 10 conversions on 1 event. The rule's premise is false as written (§3). | No. | — | Re-word the rule + removal test per client, not "every client". |
| 6 | `event_signups` as the our-tag line (§1.5 rule 1) | Table yes; **1 row in the whole table**, 0 on every event with a plan (§4). | No. | — | CIRQLIN → `event_signups` sync is the trigger; test asserts 0 on plan events and goes red when a row lands. |
| 7 | `creative_scores` (G4, §1.4) | Table yes (061), **0 rows**. A DB upsert helper exists with **no caller**. A read-time tag × result join already exists (`buildCreativeTagBreakdowns`) but is never persisted. | No — the 061 shape (axis · score · significance) holds a score; see §5 for what it cannot hold. | — | **Yes** — a scorer step in `refresh-active-creatives` (§5). |
| 8 | `client_funnel_benchmarks` (158), `event_funnel_overrides` (060), `lp_page_views` (155) | Tables exist, **0 rows each**. G5 stands. | No. | — | — |

**Migration list, in order:** 166 `campaign_plan_predictions` → 167 venue key backfill → (deferred, only if the view is ever slow) 168 `campaign_plan_benchmarks` table → (deferred, only if LEARN needs a per-tag link) 169 `creative_scores` link columns. Nothing in this list is applied by this audit.

---

## 1 · Benchmark on read

### 1.1 The query

Per client × venue × unit; a **run** is one event; **prior** means the plan's own event excluded (see §6 item 3 for why it cannot mean "show date passed"); a run counts when its spend > 0 and its results > 0 in the unit; the window is the plan's days when the event has a non-draft plan (G20) and every rollup day otherwise (no other event has a plan — §6 item 4). Cost per result is spend / results over the window; the line is `percentile_cont(0.5)`, the band `percentile_cont(0.25 / 0.75)`.

```sql
with units(unit) as (values ('signup'),('ticket'),('click'),('purchase'),('lead')),
win as (
  select e.id event_id, e.client_id, coalesce(v.name, e.venue_name) venue,
         e.event_code, e.event_date, p.start_date, p.end_date
  from events e
  left join venues v on v.id = e.venue_id
  left join lateral (
    select start_date, end_date from campaign_plans p
    where p.event_id = e.id and p.status <> 'draft'
    order by p.created_at desc limit 1
  ) p on true
),
run as (
  select w.client_id, w.venue, w.event_id, w.event_code, w.event_date, u.unit,
         sum(r.ad_spend) spend,
         sum(case u.unit when 'signup'   then r.meta_regs
                         when 'ticket'   then r.tickets_sold
                         when 'click'    then r.link_clicks
                         when 'purchase' then r.meta_purchases
                         when 'lead'     then r.meta_leads end) results
  from win w
  join event_daily_rollups r on r.event_id = w.event_id
    and (w.start_date is null or r.date >= w.start_date)
    and (w.end_date   is null or r.date <= w.end_date)
  cross join units u
  group by 1,2,3,4,5,6
  having sum(r.ad_spend) > 0
     and sum(case u.unit when 'signup' then r.meta_regs when 'ticket' then r.tickets_sold
                         when 'click' then r.link_clicks when 'purchase' then r.meta_purchases
                         when 'lead' then r.meta_leads end) > 0
)
select client_id, venue, unit,
       count(*)                                                        as n,
       percentile_cont(0.5)  within group (order by spend/results)     as median,
       percentile_cont(0.25) within group (order by spend/results)     as q1,
       percentile_cont(0.75) within group (order by spend/results)     as q3,
       array_agg(event_code order by event_date)                       as runs_used,
       min(event_date) as first_run, max(event_date) as last_run
from run
where event_id <> :plan_event_id            -- "prior" = not this plan's own event
group by 1,2,3;
```

Unit → column is the audit's mapping, not the canon's: the canon says "signup" and "ticket"; `campaign_plans.target_unit` says `reg | click | lpv | purchase | view` (165, `lib/plan/target-unit.ts`). §6 item 2 records the gap. `ad_spend` is the raw Meta column the canon quotes; `ad_spend_allocated` is identical on every NX event (the allocator has not split them), so the choice does not move a number today, but it is a choice.

### 1.2 Electric Brixton × NX Newcastle, timed

| unit | n | median | IQR | per run (DJEZ · MF · FOLAMOUR · EED · IPC) | mean, for contrast |
|---|---|---|---|---|---|
| signup (`meta_regs`) | 5 | **£2.03** | **£1.46–£2.12** | 2.03 · 5.63 · 0.90 · 2.12 · 1.46 | £2.43 |
| click (`link_clicks`) | 5 | £0.21 | £0.21–£0.23 | 0.23 · 0.21 · 0.24 · 0.21 · 0.12 | £0.20 |
| lead (`meta_leads`) | 5 | £4.06 | £2.91–£4.23 | 4.06 · 11.26 · 1.80 · 4.23 · 2.91 | £4.85 |
| purchase (`meta_purchases`) | 4 | £33.56 | £24.63–£50.24 | 25.47 · 76.00 · — · 22.11 · 41.65 (FOLAMOUR has 0) | £41.31 |
| ticket (`tickets_sold`) | **0** | — | — | `tickets_sold` is null on all 8 NX events — no ticketing connection | — |

`runs_used` = `{NX26-DJEZ, NX26-MF, NX26-FOLAMOUR, NX26-EED, NX26-IPC}`; `NX26-AZYR` and `NX26-SCHAK` drop on spend = 0 (canon §1.2a confirmed: 5, not 7). DOD itself, excluded as the plan's own event, sits at £0.55 per signup lifetime (£633.33 / 1,150).

Timing, `EXPLAIN (ANALYZE, BUFFERS)`, warm cache:

| scope | execution | planning | shared buffers | rows |
|---|---|---|---|---|
| one client × one venue (the per-render shape) | **3.7 ms** | 3.5 ms | 182 | 8 events → 2,605 day-unit rows → 22 runs → 4 groups |
| whole tenant (every client × venue × unit) | 240 ms | 2.7 ms | 20,495 | 165 events → 131,205 day-unit rows → 447 runs → 176 groups |

The per-render shape is index-driven (`events_user_client_idx` → `event_daily_rollups_event_date_idx`) and reads a few hundred pages. It is cheap enough to run on every plan render for the foreseeable size of the table; the whole-tenant pass is what a rollup would pay and it is a quarter-second.

### 1.3 Ruling: view now, table later

- **Per render:** yes. Ship it as a SQL **view**, `campaign_plan_benchmarks_v`, over the query above minus the `where event_id <> :plan_event_id` line (the read path applies that). One definition serves the plan canvas, the `ⓘ` sentence, LEARN's "next-time assumption", and the §1.5 removal-condition test.
- **Rollup table:** not earned. If it is ever needed, its shape is: `campaign_plan_benchmarks (client_id uuid, venue_key text, unit text, source_kind text, n int, median numeric, q1 numeric, q3 numeric, runs_used text[], first_run date, last_run date, computed_at timestamptz)`, key `(client_id, venue_key, unit, source_kind)`, refreshed at the end of each `/api/cron/rollup-sync-events` run (07:00 / 13:00 / 19:00 UTC) because that is the job that changes the inputs. **There is no nightly job that rolls up `event_daily_rollups`** — the canon's phrase in §1.3 does not name a real job. The nightly jobs are `funnel-pacing-refresh` (03:00) and `benchmark-alerts` (04:00); neither writes rollups.
- The §1.5 temporary rule's removal condition ("the benchmark rollup lands *and* is populated") should be re-worded to the view landing, or it will never trigger.

---

## 2 · Prediction row — migration 166 `campaign_plan_predictions`

### 2.1 Proposed DDL

```sql
-- Migration 166 — campaign_plan_predictions (canon §1.3; audit two)
-- One row per (plan, metric, unit) written at LAUNCH, its actual written at CLOSE.
-- LEARN reads rows and never recomputes. Foundation only — apply after review.
create table if not exists campaign_plan_predictions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  plan_id        uuid not null references campaign_plans (id) on delete cascade,
  metric         text not null
    check (metric in ('cost_per_unit', 'split_meta', 'split_tiktok', 'split_google', 'pace_daily')),
  unit           text
    check (unit is null or unit in ('reg', 'click', 'lpv', 'purchase', 'view')),   -- 165 vocabulary
  value          numeric(12, 4) not null,
  line_kind      text not null check (line_kind in ('measured', 'estimated', 'not_yet')),
  benchmark_rung text
    check (benchmark_rung is null or benchmark_rung in ('venue', 'client', 'client_thin', 'starting_point')),
  n              integer not null default 0 check (n >= 0),
  runs_used      text[] not null default '{}',          -- event codes, verbatim, event_date order
  date_range     daterange,                             -- first_run .. last_run of runs_used
  source_kind    text not null check (source_kind in ('meta_said', 'our_tag', 'entered')),
  predicted_at   timestamptz not null default now(),
  actual         numeric(12, 4),
  actual_at      timestamptz,
  closed_reason  text check (closed_reason is null or closed_reason in ('show', 'archived')),
  created_at     timestamptz not null default now(),
  constraint cpp_actual_pair  check ((actual is null) = (actual_at is null)),
  constraint cpp_closed_pair  check ((closed_reason is null) = (actual_at is null)),
  constraint cpp_unit_for_cost check (metric <> 'cost_per_unit' or unit is not null),
  unique (plan_id, metric, unit)
);
create index if not exists campaign_plan_predictions_open_idx
  on campaign_plan_predictions (plan_id) where actual_at is null;
alter table campaign_plan_predictions enable row level security;
create policy "Users can manage their own campaign_plan_predictions"
  on campaign_plan_predictions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Shape check against §1.3: metric ✓ value ✓ line kind ✓ n ✓ runs used verbatim ✓ (`text[]`; 0 of the 126 spend events has a null `event_code`, so no fallback is needed today) · date range ✓ · source kind ✓ (`meta_said | our_tag | entered`, the three the canon names) · predicted_at ✓ · actual ✓ · actual_at ✓ · closed_reason `show | archived` ✓. `benchmark_rung` is added so the sentence can say "from 5 shows at NX" vs "Off Pixel's starting point" without re-deriving the ladder from `n`. `unit` uses the 165 vocabulary because that is what `campaign_plans.target_unit` stores; the signup/ticket words are a display mapping (§6 item 2).

### 2.2 Who writes `actual`

`runRollupSyncForEvent` in `lib/dashboard/rollup-sync-runner.ts`, called by `/api/cron/rollup-sync-events` (07:00 / 13:00 / 19:00 UTC) — this is "the job that rolls up `event_daily_rollups`", and it is thrice-daily, not nightly. Two things it does not do today that the writer needs:

1. **Eligibility.** The cron only visits events whose sale dates fall within ±60 days of now with status `on_sale | live | upcoming` (`cron-eligibility.ts`, `ROLLUP_SYNC_WINDOW_DAYS = 60`). An event can fall out of that window before its plan closes. The `actual` writer must therefore run as its own pass keyed on `campaign_plan_predictions where actual_at is null`, not piggyback on the event loop.
2. **Archive is not a cron event.** `closed_reason = 'archived'` should be written by the same server action that sets `campaign_plans.status = 'archived'`, so the actual is stamped from the days that existed at that moment, not whenever the cron next looks.

`closed_reason = 'show'` fires on the first tick after `events.event_date` has passed in `events.event_timezone`. Note `event_date` is nullable and null on brand campaigns (e.g. `IRWOHD`), so a plan on a `kind = 'brand_campaign'` event can only ever close by archive.

### 2.3 What "plan-window days only" needs from `campaign_plans`

- `start_date` (not null for a launched plan) and `end_date` (null = open until close). The window on `event_daily_rollups.date` is `[start_date, coalesce(end_date, close_date)]`, inclusive, day-granular.
- `start_time / end_time` (159) cannot be honoured: rollups are one row per calendar day. The window is days. The doc string for 166 should say so.
- **DOD, today:** stored window `2026-08-27 10:27 → 2026-08-27 11:13` (46 minutes, one day), status `live`, target unit `click`. Under G20 its actual would read that one day: £66.59 spend, 897 clicks, 160 regs → £0.07 per click, £0.42 per signup — against a lifetime of 71 days, £633.33, 6,839 clicks, 1,150 regs. The canon already records the window as a fact for the operator; the migration should add nothing that pretends it is sane, but a launch-time validation that a window is ≥ 1 day is cheap and belongs in code, not the table.

---

## 3 · Per-platform result columns — canon §1.5 rule 2 is refuted

Canon: *"every client's history has `tiktok_spend = 0` and `google_ads_spend = null` on every event."* Production:

| | all 26,241 rollup rows | the 289 rows on the 3 plan events |
|---|---|---|
| `tiktok_results` non-null | 26,241 (column default `0`; 26,028 are 0) | 289 |
| `tiktok_results` > 0 | **213 days, 985 results** | **7 days, 43 results** |
| `tiktok_spend` > 0 | **413 days** | 7 days, £86.15 |
| `google_ads_conversions` non-null | 1,991 (1,987 are 0) | 139, all 0 |
| `google_ads_conversions` > 0 | **4 days, 10 conversions** | 0 |
| `google_ads_spend` > 0 | 34 days | 0 |

Where it lives:

| client | event | show date | TikTok spend / results | Google spend / conversions |
|---|---|---|---|---|
| IRONWORKS | `IRW0001` Jamie Jones (**has a plan**, draft ×2) | 2026-10-03 | £86.15 / 43 | — |
| IRONWORKS | `IRWOHD` Brand Awareness (always-on) | none | £2,731.35 / 511 | — |
| Junction 2 | `UTB0046-New` | 2026-08-02 (passed) | £3,309.50 / 153 | — |
| Junction 2 | `UTB0044-New` | 2026-07-31 (passed) | £1,772.81 / 103 | — |
| Junction 2 | `UTB0045-New` | 2026-08-01 (passed) | £2,306.01 / 102 | — |
| Junction 2 | `UTB0043-New` | 2026-07-26 (passed) | £1,309.03 / 73 | £113.14 / 10 |

So: for **Electric Brixton** (DOD, MALLGRAB) the premise holds — 0 TikTok, 0 Google on every event. For **IRONWORKS** the plan event itself has TikTok results. For **Junction 2** the removal condition as written ("first closed run for the client with `tiktok_results > 0`") is **already met four times over**, and once for Google. The rule must be scoped per client, and its alarm test must be per client, or it is red on day one for two of nine clients. `tiktok_results` is never null (default 0), so the outline's "no history" test must be `sum > 0`, not `is not null`.

---

## 4 · `event_signups` — confirmed, and the trigger

- Rows in the table: **1** (live 1, deleted 0). Event `160fbb1c…` "Jackies – Open Air House Music Festival – MALLORCA", client GMC Worldwide Productions, `event_code` null, one signup at 2026-07-09 20:54 UTC. **No plan.**
- Rows on any event with a plan (`NX26-DOD`, `ES26-MALLGRAB`, `IRW0001`): **0**. Canon §1.5 rule 1 and G1 confirmed. DOD's 1,150 are `meta_regs` (sum over 71 rollup days), as the canon says.
- `lp_page_views`: 0 rows, so the LPV stage is not instrumented either (event-funnel.ts already renders it as such).

**The removal trigger with a real edge:** the rule's alarm test should assert `count(event_signups where event_id in (plan events) and deleted_at is null) = 0` and go red when it is not. Today the only way that count moves is the CIRQLIN → `event_signups` sync the canon names; nothing in this repo writes `event_signups` for a plan event.

---

## 5 · `creative_scores` — what exists, what does not

**Table:** 061, 0 rows. Shape: `(event_id, creative_name, axis ∈ hook|watch|click|convert, score 0–100, significance bool, fetched_at)`.
**Writer helper:** `upsertCreativeScore` in `lib/db/creative-tags.ts:409` — **zero callers** anywhere in `app/**`, `lib/**`, `components/**`. It is a DB function waiting for a job.
**The join that already exists, read-time only:** `buildCreativeTagBreakdowns(groups, assignments)` in `lib/reporting/creative-tag-breakdowns.ts` folds `creative_tag_assignments` into the per-event `active_creatives_snapshots.payload.groups` and produces spend · impressions · reach · clicks · registrations · purchases · CPR **per tag value per event**. That is exactly "tag ↔ launched ad ↔ result". It is computed for the share view and thrown away.

**Inputs, counted:**

| | rows | note |
|---|---|---|
| `creative_tag_assignments` | 25,199 (24,986 `ai`, 213 `manual`) over 71 events, 1,450 distinct `creative_name` | the autotagger is real |
| `creative_tags` taxonomy | 90 across 8 dimensions (`asset_type` 7, `visual_format` 18, `messaging_angle` 15, `hook_tactic` 12, `headline_tactic` 15, `intended_audience` 11, `offer_type` 3, `seasonality` 9) | |
| `active_creatives_snapshots` | 449 rows, 113 events; **all 71 tagged events have one** | per-event payload with `groups[]`, `event_code`, `ad_account_id` |
| `creative_insight_snapshots` | 60,356 rows, 22,720 creative names, 30,370 ads, 2026-04-23 → 2026-09-05, presets `last_7d` / `last_30d`; 53,882 rows carry a `[CODE]` in `campaign_name` | ad-level, rolling windows, no `event_id` |

**The join key is the ad name, not Meta's creative name:** `creative_tag_assignments.creative_name` matches `creative_insight_snapshots.ad_name` for **1,388 of 1,450** names and `creative_insight_snapshots.creative_name` for **0**. Any scorer that joins on `creative_name = creative_name` scores nothing.

**Ruling: code, not migration.**
- The scorer is a step in `/api/cron/refresh-active-creatives` (the job that already writes `creative_tag_assignments` and refreshes `active_creatives_snapshots`): per event, call `buildCreativeTagBreakdowns`, and for each `(event, creative_name)` write `click` (CTR vs the event's own median CTR) and `convert` (CPR vs the event's own median CPR) rows via `upsertCreativeScore`; `hook` / `watch` from `meta_video_plays_3s` / `p100` where the group carries them. `significance` = n ≥ the same minimum-evidence rule the optimisation window uses.
- What 061 cannot hold, and what a later migration would add only if LEARN needs it: the **tag** the score is about (rows are per creative, not per tag value — LEARN's "video outperformed static" is per `asset_type` value), the **plan** it belongs to, and the **window** the results were read over (`creative_insight_snapshots` is `last_7d` / `last_30d` rolling; a closed-run score needs the run's lifetime, which only the `active_creatives_snapshots` payload for that event carries as of its last fetch). Listed as 169, deferred.
- G4's order — scoring before the join — holds: the join is built; the scorer is the missing piece; the LEARN exhibit stays locked with the system-kind sentence until `creative_scores` has rows for ≥ 1 closed run.

---

## 6 · What the schema cannot support as written

1. **"At this venue" has no key.** `events.venue_id` is null on **126 of 126** events with spend (the `venues` table exists and is unlinked); 2 events have no venue at all. The only key is `events.venue_name`, and it is not normalised: 4theFans has `Utilita Arena` and `Utilita Arena Birmingham`, `O2 Academy` beside `O2 Academy Glasgow / Leeds / Islington`, `Prospect Building` and `The Prospect Building`. A venue median keyed on the string silently splits one venue's runs into two thin ladders. Electric Brixton is clean today (`NX Newcastle`, `Electric Studios`). → migration 167 + normaliser.
2. **Unit vocabularies disagree three ways.** Canon §1.2 says "signup", "ticket"; `campaign_plans.target_unit` (165) allows `reg | click | lpv | purchase | view`; the rollup has `meta_regs`, `meta_purchases`, `tickets_sold`, `link_clicks`, `landing_page_views` (Meta's, 099 — `lp_page_views` is 0 rows), and no per-view cost column (`view` must be defined as `meta_video_plays_3s` or stay unbenchmarked). "ticket" is not a unit a plan can be set in, and `purchase` has two sources (Meta's pixel count vs the ticketing snapshot) that §1.1 says must never be blended. One table (`target-unit.ts`) must carry unit → result column → `source_kind`, and the canon's words must be its display labels.
3. **"Prior runs" cannot mean "shows that happened."** 0 of the 7 other NX shows have passed (all Oct–Dec 2026); n = 5 counts campaigns running *alongside* DOD, and the `ⓘ` "from your last 5 shows at NX" describes shows that have not happened. Across the tenant, 102 of 126 spend events have passed their date, so elsewhere the two readings diverge less. The definition the query uses — other runs of this client at this venue with spend and results, this plan's event excluded — needs a ruling and a sentence that does not say "last".
4. **Plan-window benchmarks against lifetime history.** Only 3 events have plans. Every prior run's cost per result is over the event's whole rollup life; the plan's own actual (G20) is over its window. The benchmark and the actual are computed on different windows until every run is a plan. A fact, recorded.
5. **DOD's unit is three different things.** `campaign_plans.target_unit = 'click'`; canon §1.2 argues from its "per-signup target"; G13 rules it is on sale so its unit is *per ticket*. The prediction row will store whichever the launch writes; the canon should pick.
6. **Tickets are absent where the plan is.** `tickets_sold` is null on every NX event; n = 0 for a ticket ladder at NX while 80 events elsewhere have spend and tickets. The starting-point rung will be the only ticket line at NX until a ticketing connection lands.
7. **`source_kind` has one live value.** Every signup benchmark is `meta_said`; `our_tag` has 0 rows on plan events; `entered` has no column on `campaign_plans` to be entered into.
8. **Close by show needs `event_date`.** Nullable; null on brand campaigns. Those plans close only by archive (§2.2).
9. **IQR at n = 3–4 interpolates.** `percentile_cont` on 4 runs gives Q1/Q3 between observed values (NX purchase: £24.63–£50.24 from 22.11 · 25.47 · 41.65 · 76.00). The band sentence should say "middle half" and the `ⓘ` should show the runs, which `runs_used` makes possible.
10. **Days, not times.** `start_time / end_time` exist on the plan; rollups are per day. The window is days (§2.3).

---

## Appendix — queries run (all read-only)

1. Column inventory: `information_schema.columns` for 15 tables.
2. Plans: 4 rows / 3 events; status `live` 1, `draft` 3; `target_unit` `click` 1, null 3.
3. Counts: `event_daily_rollups` 26,241 (289 on plan events); `creative_scores` 0; `creative_tag_assignments` 25,199; `creative_tags` 90; `client_funnel_benchmarks` 0; `event_funnel_overrides` 0; `lp_page_views` 0; `event_signups` 1.
4. Per-platform results, all vs plan events (§3 table).
5. `event_signups` per event (§4).
6. Electric Brixton per venue: NX 8 events / 591 rollup days / 132 spend days / 58 spend-and-regs days / 0 spend-and-ticket days; Electric Studios 1 event.
7. Benchmark query, `EXPLAIN ANALYZE`, one client × venue and whole tenant (§1.2 timings).
8. Electric Brixton × NX per-run costs and per-unit median/IQR (§1.2).
9. TikTok / Google detail per event (§3).
10. Defaults and tenant facts: `tiktok_results` default 0, `tiktok_spend` default 0, `google_ads_spend` / `google_ads_conversions` / `meta_regs` / `tickets_sold` no default; 9 clients and 126 events with spend; 102 with show passed; 80 with spend and tickets; 0 with null `event_code`; 126 with null `venue_id`; 2 with no venue.
11. Venue spellings per client with spend (§6 item 1).
12. Creative inputs: `creative_insight_snapshots` 60,356 / name-match 1,388 on `ad_name`, 0 on `creative_name`; `active_creatives_snapshots` 449 / 113 events; taxonomy and assignment sources (§5).
13. DOD plan window and its three surrounding rollup days; lifetime (§2.3).
14. Index inventory for `event_daily_rollups`, `campaign_plans`, `creative_*`, `events`.
