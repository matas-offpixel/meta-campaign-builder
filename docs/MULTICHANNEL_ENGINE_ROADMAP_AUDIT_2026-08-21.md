# Audit — The Multichannel Engine roadmap

**Date:** 2026-08-25 · **Subject:** `docs/MULTICHANNEL_ENGINE_ROADMAP_2026-08-21.md`
**Also read:** `docs/NORTHBEAM_PARITY_PATH_2026-08-21.md` (the audit it supersedes)
**Verdict:** the architecture is sound and the engineering discipline is right. The *sequencing is
wrong*, and it is wrong because the roadmap's factual base is wrong in three places that each
independently invalidate a phase.

**Note for the reviewer:** both subject documents are **untracked** in git as of `85df018`
(`git status` shows `?? docs/MULTICHANNEL_ENGINE_ROADMAP_2026-08-21.md`,
`?? docs/NORTHBEAM_PARITY_PATH_2026-08-21.md`). Roadmap step 0.3 assigns committing them to Matas
and it has not happened. This audit was scoped to one document, so it does not commit them — but
until it is done, this file cites a subject the repo does not contain.

---

## 0. Method and evidence standard

Codebase claims carry `file:line` against `85df018`. Production claims are labelled
**[measured]** and were taken by read-only SQL against the `meta-campaign-builder` Supabase
project (`zbtldbfjbhfvpksmdvnt`) on **2026-08-25**; each states its query intent so it can be
re-run. Business claims are labelled **[reasoning]**. Nothing here is inferred from an error
string or from prose docs, per roadmap §5.

I ran the production queries because three of the roadmap's load-bearing claims are about whether
data *exists*, and no amount of schema reading answers that. This turned out to matter more than
the code review did.

---

## PART 1 — Verification of the roadmap's factual claims

| # | Claim | Verdict |
|---|---|---|
| a1 | `event_daily_rollups` carries per-event per-day `ad_spend` / `tiktok_spend` / `google_ads_spend` / tickets | **CONFIRMED** |
| a2 | …and **signups** | **WRONG** — no such column exists |
| a3 | The table is "the trustworthy join" | **WRONG in production today** — the tickets column has been zero for two months |
| b | `event_signups` may not capture a `ref`/utm source; add `ref_source` | **WRONG** — capture already exists and is richer than proposed. The real problem is elsewhere |
| c | `google_ad_plans` is the prior art for `campaign_plans` | **PARTIAL / misdirected** — it is the *legacy* Google plan table; the live one is `google_search_plans`, which the roadmap never mentions |
| d | `lib/optimisation/` can be "extended cross-platform" | **WRONG as stated** — different input source, granularity, and decision basis |
| e | Google wizard: "Search only, budget UI bug open" | **PARTIAL** — Search-only is right; the budget bug was fixed in #448; the roadmap appears to have the wrong Google surface in mind |
| f | Meta↔TikTok audience clusters are shared category names | **PARTIAL** — the strings are literally identical for 6 of 7, but there is no shared module and no preset-level mapping |

**Score: 1 confirmed, 4 wrong, 3 partial.**

### a. `event_daily_rollups` — the columns are there; the trust is not

**Columns — CONFIRMED.** `ad_spend` (`supabase/migrations/039_event_daily_rollups.sql:41`),
`tickets_sold` (`039:45`), `tiktok_spend`
(`supabase/migrations/056_event_daily_rollups_tiktok_columns.sql:9`), `google_ads_spend`
(`supabase/migrations/064_event_daily_rollups_google_ads_columns.sql:9`), plus allocated/presale
spend (`046:52`, `048:48`), `meta_regs` (`044:69`), `meta_purchases`/`meta_leads`
(`093_meta_purchases_split.sql:44`), `landing_page_views` (`099:36`), and Meta awareness metrics
(`066:7-12`).

**`signups` — WRONG.** There is no signups column. The roadmap asserts one twice
(`MULTICHANNEL_ENGINE_ROADMAP_2026-08-21.md:21` and `:59-62`) and the superseded audit asserts it
too (`NORTHBEAM_PARITY_PATH_2026-08-21.md:42`). Signups live only in `event_signups`, written by
the landing-page handler (`lib/landing-pages/signup-store.ts:87-107`). No cron aggregates them
into the rollup. This is not pedantry: Phase 2.1 proposes reading "signups joined via
`ref_source`" from the plan results API scoped to `event_daily_rollups` — that join does not
exist and the phase estimate does not include building it.

**Population — CONFIRMED and healthier than the roadmap fears.** All four legs run in one
orchestrator, `runRollupSyncForEvent` (`lib/dashboard/rollup-sync-runner.ts`), behind a single
cron `/api/cron/rollup-sync-events` at `0 7,13,19 * * *` (`vercel.json:13-14`), plus a show-week
burst at `0 9,15,21` (`vercel.json:21-22`). Meta, TikTok and Google are legs of the *same* run
(`rollup-sync-runner.ts:468-501`), so there is no cross-platform cadence skew — a real risk the
roadmap worried about that does not exist. Per-platform upserts deliberately touch only their own
columns (`lib/db/event-daily-rollups.ts:553-559`, `:651-656`), so a skipped leg leaves nulls
rather than corrupting siblings.

**"Trustworthy join" — WRONG, and this is the single most important finding in the audit.**

**[measured, 2026-08-25]** `event_daily_rollups.tickets_sold` summed by month:

| Month | rollup `tickets_sold` | events with tickets | `ticket_sales_snapshots` rows | events with snapshots |
|---|---|---|---|---|
| 2026-05 | 16,384 | 63 | 12,211 | 78 |
| 2026-06 | 8,339 | 53 | 14,035 | 77 |
| **2026-07** | **0** | **0** | 11,613 | 76 |
| **2026-08** | **0** | **0** | 7,445 | 75 |

The ticketing pipeline is alive — 7,445 snapshot rows across 75 events this month, last snapshot
`2026-08-25`. The rollup's ticket column has been **silently zero for two consecutive months**.
The rollups are otherwise fresh (`max(date) = 2026-08-25`, 988 rows across 136 events in the last
7 days, all four `source_*_at` stamps current), so this is not a stale-table problem — it is a
broken leg inside a healthy run, which is exactly the failure mode that hides.

The roadmap's Phase 0.1 hard prerequisite is "kill v2's duplicate cron fleet… it corrupts the
rollup data every later phase trains on." That may well be true, but the *measured, present-tense*
defect is a conversion column reading zero, and the roadmap does not know about it. Phase 2 built
on this ships a client dashboard reporting zero tickets for the current quarter.

### b. `event_signups` — the capture exists; the data does not

**The proposed migration is unnecessary.** Roadmap step 0.2 says to verify whether `event_signups`
persists a ref param and, "if absent", add `event_signups.ref_source`. It is not absent. The table
has carried `source` (text), `utm` (jsonb) and `referrer_url` since it was created
(`supabase/migrations/134_event_signups.sql:98-100`). The signup handler persists all three
(`lib/landing-pages/signup-store.ts:87-107`). The client captures them first-touch into
sessionStorage (`lib/landing-pages/attribution.ts:29-50`) and posts them
(`components/landing-pages/signup-form.tsx:253-283`).

It is also *richer* than the proposed `mt|tt|gg` enum: the allowlist already stores
`utm_source/medium/campaign/term/content`, `fbclid`, `ttclid` and `gclid`
(`lib/landing-pages/signup-schema.ts:189-198`), and already infers `paid_meta` / `paid_tiktok` from
click ids (`signup-schema.ts:204-209`). Click-id presence is a *better* attribution signal than a
self-set `ref` param, because it survives the platform's own redirect and cannot be stripped by a
share.

**But two things are broken underneath it.**

1. **`ref=mt|tt|gg` is stamped by nothing.** Grepping `ref=(mt|tt|gg)|ref_source|\?ref=` across the
   repo excluding `docs/` returns only two unrelated D2C WhatsApp test fixtures. The roadmap's
   design decision 3 (`:122-125`) and the superseded audit's "the landing pages already receive
   `?ref=tt`-style params" (`NORTHBEAM_PARITY_PATH_2026-08-21.md:100-102`) describe a convention
   that does not exist in code. The read side is built; the write side is not.
2. **[measured, 2026-08-25] The table has one row.** `select count(*) from event_signups` → **1**,
   created `2026-07-09`, with zero utm keys. `page_events` → 1 row. `client_landing_pages` → 1.
   Against 164 events and 16 clients.

So step 0.2 — "this starts the Phase-5 training clock — do it FIRST" — starts no clock. Adding a
column to an empty table does not accumulate data. The binding constraint is that the landing-page
product is effectively unshipped, and the roadmap has no step for that.

### c. `google_ad_plans` — right instinct, wrong table

The roadmap says to read `google_ad_plans` before designing `campaign_plans` (`:69-70`, `:174`).
Reading it is correct advice pointed at the wrong artifact.

`google_ad_plans` (`supabase/migrations/017_google_ads_platform.sql:85-110`) is a Google-only,
jsonb-blob plan: `total_budget`, `google_budget`, `google_budget_pct`, and a `campaigns` jsonb
tree. It is written by exactly three routes (`app/api/google-ads/plans/route.ts:121`,
`app/api/google-ads/plans/[planId]/route.ts:106,144`) and has no link to any launched campaign.

The **live** Google system is `google_search_plans` (`supabase/migrations/096_google_search_plans.sql:29-45`)
plus six normalised child tables, with `pushed_resource_name` on pushable rows and a status
lifecycle of `draft|pushed|partially_pushed|archived`. That is the table with real prior art for
"a plan that launches and tracks what it created" — and the roadmap never mentions it.

There *is* genuine overlap worth designing against: `google_ad_plans` already models
"total budget, this platform's share, this platform's percentage", which is the exact shape
`campaign_plan_splits` proposes. Worth aligning with. But a Cursor prompt told to "read
`google_ad_plans` first" will study the deprecated one.

### d. `lib/optimisation/` — a rewrite wearing a reuse costume (the roadmap's own phrase, and yes)

Three independent mismatches, any one of which breaks the "extend" framing:

1. **Different input source.** The shipped evaluator reads **live Meta Graph Insights** —
   `/{campaignId}/adsets` with nested `insights.date_preset(...)`
   (`lib/optimisation/insights-fetch.ts:103-121`), wired to `graphGetWithToken` at the cron
   boundary (`app/api/cron/optimisation-tick/route.ts:113-118`). It never reads
   `event_daily_rollups` — that string does not appear anywhere under `lib/optimisation/`. Phase
   3.2 proposes deciding from "the Phase-2 series", i.e. rollups. Different data path end to end.
2. **Different granularity.** Decisions are per Meta **ad set** (`lib/optimisation/tick-runner.ts:199-277`),
   writing `daily_budget` on an adset id (`lib/optimisation/apply.ts:204-206`), and CBO ad sets are
   explicitly skipped because they have no per-ad-set budget (`tick-runner.ts:341-352`). Plan
   splits are per *platform*. "Ad set" has no cross-platform referent — the audit table itself is
   Meta-shaped down to the column comments (`supabase/migrations/151_campaign_automation_decisions.sql:26-42`).
3. **Different decision basis — the one nobody has noticed.** `evaluate.ts` is the only genuinely
   portable module (it declares itself pure at `lib/optimisation/evaluate.ts:7-8`), and it is a
   **rule-threshold engine**: it matches configured `OptimisationRule` bands against a single
   `liveMetric` reading and returns scale_up/scale_down/pause/maintain
   (`evaluate.ts:62-86`). Phase 3.2 wants **marginal cost-per-signup compared across platforms**.
   That is a different function with different inputs and different failure modes. So even the 30–40%
   of lines that are technically portable implement logic the new phase does not want.

Also Meta-bound: metric resolution hard-codes Meta `action_type` strings
(`lib/optimisation/live-metric.ts:36-44`) and Meta `date_preset` values (`:89-107`); gates read
`campaign_drafts` columns (`lib/optimisation/gates.ts:9-10`); the opt-in loader requires
`draft.metaCampaignId` (`lib/db/campaign-automation-decisions.ts:50-78`).

**Verdict:** cross-platform reallocation is a new module. Budget it as one. The honest reuse is the
*3-gate pattern* (`optimisationDryRunGates`) and the shadow-row discipline — patterns, not code.

### e. The Google launcher — better than the roadmap thinks, and differently shaped

The roadmap's "Search only, budget UI bug open" (`:57-58`) understates and misdirects.

**There are two Google surfaces.** `POST /api/google-ads/launch` is an explicit stub that always
returns `not_configured` (`app/api/google-ads/launch/route.ts:5-52`), and the `google_ad_plans`
plan-builder only saves (`components/google-ads/plan-builder.tsx:171-206`). The **real** launcher is
`POST /api/google-search/[id]/push` (`app/api/google-search/[id]/push/route.ts:29-44`), driven by
`pushGoogleSearchPlan` (`lib/google-ads/campaign-writer.ts`), which performs real sequential mutates
for budget → campaign → geo criteria → sitelink assets → ad groups → keywords → negatives → RSAs.
OAuth is fully wired and credentials are decrypted per account
(`app/api/google-ads/oauth/callback/route.ts:72-109`, `push/route.ts:121-148`).

**Search-only: CONFIRMED**, hard-coded `advertisingChannelType: "SEARCH"`
(`lib/google-ads/campaign-writer.ts:946-957`). No PMax/Display/Video.

**"Budget UI bug open": stale.** The monthly-vs-daily bug (a £1 entry pushing as £0.03/day) was
fixed in PR #448 and pinned by regression tests
(`lib/google-ads/__tests__/campaign-writer.test.ts:760-764`). A cosmetic inconsistency remains —
the Targeting & Budget step still totals against `monthly_budget`
(`components/google-search-wizard/steps/targeting-budget.tsx:23-25`) while push reads
`daily_budget` — but it is not a money bug.

**The real gap is shape, not maturity, and it is fatal to Phase 1.5 as scoped.** Meta and TikTok
drafts are jsonb blobs (`campaign_drafts.draft_json`, `supabase/schema.sql:184-196`;
`tiktok_campaign_drafts.state`, `supabase/migrations/058_tiktok_campaign_drafts.sql:6-16`), so a
"prefill the draft" adapter is field assignment. Google is a **normalised seven-table tree** with no
blob. Prefilling it means generating campaigns, ad groups, **keywords**, negatives and **responsive
search ad copy** — keyword research and copywriting, not field mapping. Steps 1.3, 1.4 and 1.5 are
listed as three equivalent PRs. 1.5 is a different and much larger project.

Secondary gaps vs the other two launchers, for completeness: no env killswitch (TikTok has
`lib/tiktok/write/feature-flag.ts:1-6`), no dedicated preflight module (TikTok has
`lib/tiktok/write/preflight.ts`), idempotency is per-row `pushed_resource_name` rather than a
dedicated table (`lib/google-ads/campaign-writer.ts:29-32`), and no operator-facing error taxonomy.
It does have partial rollback (`campaign-writer.ts:439-456`).

### f. Cluster alignment — identical strings, no shared source of truth

The six Meta cluster labels (`lib/interest-suggestions.ts:3-11`) and the first six TikTok cluster
labels (`lib/tiktok-wizard/genre-presets.ts:16-24`) are **byte-identical strings**: "Music &
Nightlife", "Fashion & Streetwear", "Lifestyle & Nightlife", "Activities & Culture", "Media &
Entertainment", "Sports & Live Events". TikTok adds "Streaming", correctly documented as
TikTok-only (`genre-presets.ts:8-12`).

Two caveats the roadmap's "shared" framing hides:

1. **There is no shared module.** The same string literals are independently redeclared in at least
   seven places — `lib/interest-suggestions.ts:6`, `lib/discovery-diversity.ts:36`,
   `lib/scene-hint-presets.ts:100`, `lib/audience-personas.ts:108`, `lib/meta/adset.ts:1477`,
   `app/api/meta/interest-discover/route.ts:1638`, `lib/tiktok-wizard/genre-presets.ts:18`. PR #809's
   session log flags consolidation as an explicit follow-up
   (`docs/session-logs/pr-809-meta-surface-interest-presets.md:27-28`). Alignment is held by
   convention, and nothing fails if it drifts.
2. **The mapping the roadmap needs is one level deeper than the alignment that exists.** Design
   decision 2 (`:117-119`) wants `cluster → that platform's preset`. Cluster *labels* match;
   *presets* do not. TikTok presets are slugs like `electronic-music` (`genre-presets.ts:98`); Meta
   scene hints are keyed `${clusterLabel}::${bucket}` (`lib/scene-hint-presets.ts:403`). No mapping
   table exists in either direction.

**Net:** a plan-level neutral `cluster` string is viable today at cluster granularity. Anything
finer is new work, and the shared-constant module is a genuine (small) prerequisite.

---

## PART 2 — Challenges

Eight substantive disagreements. Where I agree, one line.

**Agreed, no restatement needed:** orchestrate-never-rebuild (§4.1); recommendations as rows before
writes (§4.4); the 3-gate write pattern; additive migrations with migrate-on-load; provenance
labelling as the credibility line (§1); the entire §5 rules of the road; the §8 not-building list;
never fitting curves per single event (§1).

### D1 — The engine is being built for a multichannel business that does not exist yet

**[measured, 2026-08-25]** Spend by platform, from `event_daily_rollups`:

| Month | Meta | TikTok | Google |
|---|---|---|---|
| 2026-05 | £228,511 | £2,623 | £75 |
| 2026-06 | £311,116 | £3,261 | £151 |
| 2026-07 | £378,503 | £4,596 | £52 |

July: **Meta 98.8%, TikTok 1.2%, Google 0.014%.**

And the multichannel *subject population*, across all history: of 127 events with any spend, 124 ran
Meta, 9 ran TikTok, 3 ran Google. **Seven events ever ran two or more platforms. Two ran all three.**
Restricting to same-day concurrency — the only case where "shift tomorrow's split" is even a
coherent instruction — **six events**, 321 event-days out of 10,819.

The roadmap's centre of gravity (Phase 3 cross-platform reallocation, Phase 5 per-platform response
curves) is aimed at a decision that has been available six times.

**[reasoning]** I do not read this as "don't go multichannel" — the strategic case for TikTok/Google
diversification is real and the launchers are built. I read it as: the roadmap treats multichannel
allocation as a *measurement and decisioning* problem when it is currently an *adoption* problem.
No allocation engine improves a 98.8/1.2 split; a media buyer deciding to run TikTok at all does.
Build the thing that makes the second platform easy to run and easy to justify, and only build the
allocator once there is a population to allocate across.

**Cost of the original's choice:** Phases 3–5 (roughly 13–19 PRs) produce recommendations for ~6
historical events, and Phase 5's curve fitting needs per-platform history that 9 TikTok events and 3
Google events cannot supply at any pooling level.

### D2 — Phase 0 guards the wrong integrity risk; the join is already broken

Detailed in Part 1a. The roadmap's Phase 0.1 blocks on a *hypothesised* corruption (duplicate v2
crons). The *measured* defect is `tickets_sold` reading zero for July and August across all 136
active events while `ticket_sales_snapshots` holds 19,058 rows for those months.

This matters beyond one bug. It is proof that a rollup leg can fail silently and indefinitely with
nobody noticing, in the exact table three later phases train on. The roadmap's risk register lists
"v2 cron fleet corrupting rollups" with the mitigation "Phase 0.1 hard prerequisite" (`:304`) — a
one-time fix for a continuous risk.

**Counter:** Phase 0 must ship a *standing* rollup integrity check, not a one-time cron cull: assert
that a metric with upstream source rows is non-zero downstream, and alert through the existing
`notify()` service on breach. Without it, every subsequent number is unfalsifiable.

**Cost of the original's choice:** Phase 2's checkpoint C2 is "the dashboard's per-platform spend
matches Ads Managers within tolerance" — a *spend*-only check. It would pass today with the ticket
column at zero, certifying a broken join as trustworthy.

### D3 — Step 0.2 solves a schema problem when the problem is adoption

Detailed in Part 1b. Capture exists and is richer than proposed; the table has **one row**;
`ref=mt|tt|gg` is stamped by nothing; there is one landing page and one `page_events` row against 164
events.

The roadmap's causal chain is: add `ref_source` → fan-out stamps it → signups attribute per channel
→ Phase 5 trains on the history. Link one is already done. Link two is unbuilt. Links three and four
are blocked not by schema but by the fact that fans are not arriving on our pages.

**Counter:** the honest Phase 0 attribution question is not "does the column exist" but **"where do
our live ads actually point?"** `AdCreativeDraft.destinationUrl` is free text (`lib/types.ts:726`) —
nothing constrains it to a landing page we own, and nothing measures what share of live spend drives
to our pages versus RA, Dice, Eventbrite or a client site. That measurement is a half-PR and it
determines whether the entire first-party attribution premise is reachable. Do it before designing
around it.

**Cost of the original's choice:** "do it FIRST… starts the Phase-5 training clock" creates a false
sense that time is now accruing toward Phase 5. It is not. Three months later the table still has
~1 row and Phase 5 is discovered to be blocked, having been "in progress" the whole time.

### D4 — "Extend `lib/optimisation/` cross-platform" should be struck and re-scoped

Detailed in Part 1d: different input source (Meta Insights vs rollups), different granularity (ad set
vs platform), different decision basis (rule bands vs marginal CPS). The reuse is patterns, not code.

**Counter:** name Phase 3 "new cross-platform allocator" and budget it honestly (~5–7 PRs of new
code, not "extend"), *or* — my preference, see D5 — do not build it yet and instead invest in the
Meta-internal loop that already has 98.8% of the spend and a working evaluator.

**Cost of the original's choice:** a phase estimated as an extension that is a green-field build
will overrun, and the overrun will be discovered at the point where `insights-fetch.ts` turns out to
be unusable — i.e. after the schema and UI are already committed to it.

### D5 — At current spend, marginal CPS over 3/7-day windows cannot beat "do nothing"

Part 2d of the brief asks directly. My answer is no, and not marginally so.

**[measured, 2026-08-25]** Across all event-days with spend: median **£36.83/day** per event, mean
£100.79, p90 £218.97. In the last 14 days the whole book has been 4–7 spending events at £30–£560/day
*in total*.

**[reasoning]** Take the roadmap's own £25–50/day and a generous £3 cost-per-signup: ~8–16 signups per
platform per day, so **25–50 conversions in a 3-day window** and 60–120 in a 7-day window. Detecting a
20% relative difference between two proportions at conventional power needs conversion counts in the
high hundreds per arm. A 3-day window is off by roughly an order of magnitude. And *marginal* CPS is
strictly noisier than average CPS, because it is a difference of two noisy estimates — the roadmap
picks the harder estimand at the smaller sample size.

The compounding problem: the conversion signal it would use is signups, which is `n=1` (D3), and
tickets, which is zero for two months (D2). So the estimator is under-powered *and* currently
unfed.

**My minimum-data bar, if this is built anyway:** no recommendation unless the window contains
**≥100 attributed conversions on each arm** and **≥7 days** of concurrent spend on both platforms and
both platforms are above their budget floor. **[measured]** Applied to history, approximately zero
events would ever have qualified.

**Counter-basis — what does work at £25–50/day:** deterministic, non-statistical checks that are
right by construction rather than by inference.

- **Pacing vs plan.** Already 80% built: `/api/cron/budget-pacing-check` evaluates lifetime spend
  against planned budget and fires threshold alerts. "You are 60% through budget with 80% of the
  campaign remaining" needs no statistical power and is immediately actionable.
- **Phase-based playbooks.** The roadmap correctly identifies (`:36-40`) that announce/presale/on-sale
  boundaries are deterministic fields. Encode the media-buying rules directly — "presale ends in 48h
  and daily budget has not stepped up" is a rule, not an inference, and it is exactly the kind of
  call a buyer makes.
- **Delivery-health checks.** Zero-delivery ad sets, exhausted frequency, rejected creative, learning
  phase never exited. Deterministic, high-value, no sample-size requirement.

**[reasoning]** These are also more *defensible* in a client meeting than a marginal-CPS number,
because they do not require the client to accept a statistical claim.

### D6 — "Launch all" is unsafe today: the three platforms have incompatible launch states

Phase 1.6 fans out to the existing launch routes and models partial success. It does not address that
the three routes land in **different states**:

- **Meta launches ACTIVE and spends immediately** — `app/api/meta/launch-campaign/route.ts:14`
  ("All campaigns, ad sets, and ads are created in ACTIVE status — spending begins immediately on
  launch"), reaffirmed at `:1247`.
- **TikTok launches DISABLE** (`operation_status: "DISABLE"`, per `lib/tiktok/write/orchestrator.ts`).
- **Google launches PAUSED** (`lib/google-ads/campaign-writer.ts:946-957`).

So one click produces one platform spending money and two platforms inert. The operator must
remember to go and enable two of three, and the plan's "live" status will be a lie about at least one
of them.

Worse, on partial failure: TikTok cleans up its campaign (`cleanupTikTokCampaign`, fixed in #834 to
use `/campaign/status/update/` with `operation_status: DELETE`), Google rolls back an empty shell
(`campaign-writer.ts:439-456`), and **Meta does neither** — grepping
`rollback|cleanup|delete.*campaign|idempot` across `app/api/meta/launch-campaign/route.ts` returns
**zero matches**. A fan-out that fails after Meta succeeds leaves a live, spending, un-tracked Meta
campaign, and re-launching the failed splits has no idempotency guard on the Meta side.

**Counter:** normalising launch state to paused-by-default across all three, and giving Meta the
rollback + idempotency the other two have, is a hard prerequisite for any fan-out. It is also
independently valuable and small. The roadmap does not mention it anywhere.

**Cost of the original's choice:** the first partial-failure fan-out spends real client money on an
orphaned Meta campaign — the same class of bug as #834, which took ten orphaned TikTok campaigns to
surface, except this one has a budget attached.

### D7 — Ship the blended view before the plan object; it needs no new schema

The roadmap's ordering axiom is spine → join → decisions (`:26-28`), justified by "never build a layer
before the one below it is trustworthy." I agree with the axiom and think it argues *against* the
roadmap's own order.

Phase 2 is described as per-plan blended results. But decompose what it actually renders: per-platform
spend, per-channel cost-per-result, blended totals, daily trend. Every one of those is keyed by
**event and date range**, which `event_daily_rollups` already provides. The *only* element requiring a
plan object is planned-vs-actual split drift (2.1, 2.4).

So ~80% of the billable reporting tier is shippable with **zero new schema**, against 136 events with
live data, today. The plan spine (6–9 PRs) is a prerequisite only for the drift feature.

Meanwhile the plan object is the *least* validated part of the design — it commits to jsonb-blob-style
orchestration over three draft stores whose shapes diverge sharply (Meta's `migrateDraft` is ~225 lines
of accumulated schema drift at `lib/autosave.ts:229-453`; TikTok's is ~73 at
`lib/tiktok-wizard/migrate-draft.ts:15-87`; Google has no blob at all). Building it first means
committing to the shape before the reporting layer has taught you what the shape needs to be.

**Counter-order:** fix the join → ship the blended event view → *then* decide whether the plan object
earns its cost, informed by whether multichannel adoption actually happened.

**Cost of the original's choice:** 6–9 PRs of spine before the first client-visible, billable artifact
ships — in a phase whose checkpoint C1 ("launched to ≥2 platforms in one action") describes an action
taken six times in the product's history.

### D8 — Cut the HTTP API and MCP surface entirely, do not merely move them

Phase 4.4/4.5. The brief asks whether to cut, keep, or move. **Cut.**

Three reasons. First, sequencing: an MCP that applies budget writes is a control surface over a
recommendation engine whose quality is explicitly unproven until C3 — and C3's bar ("Matas would have
made the same call ≥70% of the time") cannot be met at the sample sizes in D5. Second, blast radius:
`POST /api/plans/[id]/apply-split` is an authenticated, non-interactive path to mutating live ad
budgets, and the surface most likely to invoke it is an LLM. Every existing live-write path in this
repo sits behind a three-of-three gate for good reason; an MCP tool call is a *weaker* confirmation
than a human clicking Apply in a dashboard, not a stronger one. Third, and most simply: the user is
Matas. "Shift £50/day from Google to TikTok on the Jamie Jones plan" is a sentence he can also express
by clicking a button in a dashboard he owns, on one of the six events where it applies.

**[reasoning]** The roadmap's own framing — "This is the contract the MCP wraps — design it as the
product" (`:247`) — is the tell. It is the most architecturally satisfying phase and the least
connected to revenue. §10 maps Phases 3–4 to the "optimisation tier", but the sellable half of that
tier is the recommendations, not the API.

**Keep in the back pocket:** if a client ever asks for programmatic access, the API is a small build
*on top of* a proven decision layer. Building it before is building a contract around a function whose
signature will change.

### What the roadmap misses entirely

1. **Meta launch rollback + idempotency** (D6). The one launcher handling 98.8% of spend is the one
   without a safety net.
2. **A standing rollup integrity assertion** (D2). The tickets-zero bug is proof the current answer is
   "nobody notices for two months."
3. **Landing-page adoption measurement** (D3). Nothing measures what share of live ad spend points at a
   destination we can attribute. The whole first-party premise rests on an unmeasured assumption.
4. **Creative as the actual lever.** Phase 6 is "anytime after Phase 2", 3–4 PRs, last. **[reasoning]**
   At £25–50/day per event, Meta's own delivery optimisation allocates budget across ad sets better
   than a nightly cron will; the variance that a human can actually move is in creative and audience,
   not in a 10% budget shift. The repo already has `creative_tags`, `creative_scores`, AI autotag and
   cross-platform active-creative snapshots — more raw material than the allocation phases have.
   Creative learnings are underweighted by several phases.
5. **A shared cluster constant** (Part 1f). Small, real, and a prerequisite for the intent→adapter
   mapping the roadmap already commits to.

### What to delete as entry-level scope

- **Phase 4.4 + 4.5** (API + MCP) — D8.
- **Phase 5 entirely, for now** — its training set is 9 TikTok events and 3 Google events, and its
  target variable is a table with one row. Revisit when D1 and D3 have moved.
- **Phase 1.5** (Google adapter) — 0.014% of spend, and a categorically larger build than 1.3/1.4
  (Part 1e).
- **Phase 1.8** (brief prefill) — correctly marked optional; it is a demo feature, not a constraint.

---

## PART 3 — Counter-roadmap

Same format. The reordering principle: **fix what is measurably broken, ship what is billable with
no new schema, prove multichannel adoption, and only then build the machinery that assumes it.**

### Phase A — Make the existing numbers true (3–4 PRs) — *replaces Phase 0*

The roadmap's Phase 0 is one Vercel chore plus a migration that turns out to be unnecessary. This is
the phase that earns the right to show anyone a number.

- **A.1 — Fix the rollup tickets leg.** Root-cause why `event_daily_rollups.tickets_sold` has been
  zero since 2026-07-01 while `ticket_sales_snapshots` kept ingesting (19,058 rows, 76 events, over
  the dead window). Backfill July–August from snapshots. Falsify-before-fix: the regression test must
  fail against `85df018`.
- **A.2 — Standing rollup integrity check.** A cron assertion, alerting via the existing `notify()`
  service on `ads_ops`: for each metric with an upstream source, if source rows exist for a window and
  the rollup column is zero across all events, alert. Generalise beyond tickets — this is the guard
  that makes every later number falsifiable.
- **A.3 — Destination-URL audit.** Report what share of live ad spend points at a URL we own and can
  attribute, versus RA/Dice/Eventbrite/client sites. Read-only; consumes `destinationUrl`
  (`lib/types.ts:726`) across published drafts. **This is the go/no-go input for the entire
  first-party attribution strategy** and it currently has no evidence behind it either way.
- **A.4 (Matas)** — kill the v2 duplicate cron fleet (#135). *Unchanged — agree*, but demoted from
  blocking: A.2 detects the corruption it might cause, which is the durable fix.

**Checkpoint CA:** every metric on the existing event dashboard is either correct or alarming. No
number is silently zero. We know where our ad clicks land.

*Why this replaces Phase 0:* the original's 0.2 migration is unnecessary (Part 1b) and its 0.1 is a
one-time fix for a continuous risk (D2).

### Phase B — Ship the billable blended view, no new schema (3–4 PRs) — *Phase 2, promoted, minus drift*

- **B.1 — Blended results API, keyed by event.** Per-event daily series from `event_daily_rollups`:
  spend per platform, per-channel cost-per-result, blended totals. Provenance label on every number
  (deterministic ticket / platform-reported conversion / signup). *Unchanged from 2.1 — agree* on
  content; the divergence is that it is keyed by **event**, not plan, so it needs nothing new.
- **B.2 — Blended dashboard.** Reuse existing chart components. Ships against **136 events with live
  data today**, versus zero plans.
- **B.3 — Reconciliation tile.** *Unchanged — agree* (original 2.3).
- **B.4 — Provenance + coverage honesty.** Show attributed vs unattributed explicitly, and show
  *coverage* (how many of this event's conversions are deterministically sourced at all). Answers Part
  2c: see below.

**On the brief's question 2c — is `ref=mt|tt|gg` sufficient?** No, and the roadmap's own instinct is
better than its design. A self-set `ref` param is the weakest available signal: it is stripped by
in-app browser redirects, lost on dark-post shares and organic re-shares, absent on any cross-device
journey, and absent entirely on the "saw the ad, searched the event later" path that dominates event
marketing. **[reasoning]** I would expect **50–75% unattributed** at entry level, and higher for
TikTok, where in-app browsing and later-search behaviour are the norm.

The better primitive is already built and unused: click ids. `fbclid`/`ttclid`/`gclid` are already in
the capture allowlist (`lib/landing-pages/signup-schema.ts:189-198`) and already drive source
inference (`:204-209`). They are set by the platform, survive its own redirect, and cannot be
stripped by a share. **Use click-id presence as the primary deterministic join and `ref` only as a
fallback** — one line of design change, materially better data.

Does "show the remainder honestly" survive a client meeting? **[reasoning]** Only if the remainder is
framed as *coverage* rather than *loss*, and only if the number is stable month to month. "We can
deterministically source 35% of signups; here is that cohort's cost-per-signup, and here is the
platform-reported view of the rest" is a credible sentence. "65% unattributed" alone reads as a broken
product. This is a UI framing decision that should be made deliberately in B.4, not discovered in the
meeting.

**Checkpoint CB:** a client can be shown one screen, with no spreadsheet, and every number on it is
either deterministic-and-labelled or modelled-and-labelled. **This is the reporting tier, and it is
billable — reached without a single new table.**

### Phase C — Make the second platform safe and cheap to run (4–6 PRs) — *the adoption phase; the roadmap has no equivalent*

D1 says the bottleneck is adoption, not allocation. This phase attacks that directly, and it is the
biggest divergence from the original.

- **C.1 — Normalise launch state.** All three launchers land paused by default; enabling is an
  explicit second action. Removes the fan-out asymmetry (D6) and de-risks Meta launches generally.
- **C.2 — Meta rollback + launch idempotency.** Bring the 98.8%-of-spend launcher up to the standard
  TikTok reached in #834 and Google has at `campaign-writer.ts:439-456`. Prerequisite for any
  multi-platform launch; valuable standalone.
- **C.3 — Shared cluster constant.** One `ClusterLabel` module; Meta and TikTok both import it; the
  seven duplicate declarations (Part 1f) collapse. Small, and unblocks any future intent→adapter work.
- **C.4 — Cross-platform creative learnings.** *Original Phase 6, promoted several phases.* Which
  tagged creative families perform per channel, using the existing `creative_tags` / `creative_scores`
  / active-creative snapshots. **[reasoning]** This is the highest-value-per-PR item in either
  roadmap: it works at current spend levels (creative differences are large and visible where 10%
  budget shifts are not), it needs no new attribution, and it is the question clients actually ask.
- **C.5 — TikTok launch ergonomics.** Whatever the last live launch proved painful. **[reasoning]**
  Nine events have ever run TikTok; the marginal return on making the tenth easy exceeds the marginal
  return on optimising across the six that ran two platforms.

**Checkpoint CC:** running a second platform on an event is a routine decision, not a project. The
measure is adoption — **if the two-plus-platform event count has not moved off 7 within a quarter,
stop and reconsider the entire multichannel thesis before building Phase D or E.**

*This checkpoint is the most important one in this document.* The original roadmap has no gate that
can ever tell it the premise is wrong.

### Phase D — Deterministic recommendations (4–5 PRs) — *replaces Phase 3's marginal-CPS engine*

Only after CB. Explicitly **not** the statistical allocator (D5).

- **D.1 — `recommendations` schema.** *Structurally unchanged from 3.1 — agree*, except keyed to
  **event** (consistent with Phase B) and typed for deterministic checks:
  `pacing_behind | pacing_ahead | phase_step_up | delivery_stalled | creative_exhausted`. Note the
  absent type: no `shift_split`.
- **D.2 — Pacing + phase playbook evaluator.** Extends the shipped
  `/api/cron/budget-pacing-check` and `lib/budget-pacing/plan.ts` — a **genuine** reuse, unlike the
  `lib/optimisation/` one (D4). Deterministic rules against announce/presale/on-sale boundaries.
- **D.3 — Delivery-health checks.** Zero-delivery ad sets, frequency ceilings, rejected creative,
  stuck learning phase. No sample-size requirement.
- **D.4 — Surface + dismiss.** Panel plus Slack via the existing notify service with dedupe.
  *Unchanged from 3.3 — agree.*

**Checkpoint CD:** a media buyer agrees with ≥70% of recommendations — the original's C3 bar, now
attached to recommendations that can actually meet it because they are deterministic rather than
inferred from 30 conversions.

### Phase E — Cross-platform allocation (5–7 PRs) — *the original Phase 3, gated*

**Entry gate, absolute:** CC passed (multichannel adoption is real) **and** ≥15 events with ≥14 days
of concurrent two-platform spend **and** the D5 minimum-data bar is met by a non-trivial share of
them. **[measured]** Today: 6 events, 321 concurrent event-days, zero would clear the bar.

Only then is the plan object earned — and by then Phase B will have taught us what it needs to hold.
Build it as a **new** allocator module, budgeted as new code (D4), reusing the 3-gate pattern and
shadow-row discipline but not `insights-fetch.ts`, `live-metric.ts` or `evaluate.ts`.

**On the brief's question 2a — plans-as-orchestrator vs plans-owning-canonical-state:** if this phase
is ever reached, **orchestrator, not canonical owner** — the original is right and I agree. The
argument for canonical state is deduplicating three divergent draft shapes; the argument against is
decisive: Meta's `migrateDraft` is 225 lines of accumulated drift (`lib/autosave.ts:229-453`) and
Google is not a blob at all (Part 1e). A canonical plan would have to be a superset of three
divergent models and would inherit all three migration burdens, while every wizard kept writing to
its own store anyway. Plans stay thin: budget, split, schedule, intent, and links out. The original's
design decision 1 stands.

**Not building here:** per-platform response curves, forecasting, MCP.

### Phase F — Forecasting — *original Phase 5, gated and deferred*

**Entry gate:** Phase E live, and a conversion signal with real volume — meaning A.3 showed our ads
point at pages we own, *or* deterministic ticketing coverage expanded beyond the current two
connections (`eventbrite`, `fourthefans`).

**[measured]** Neither holds today: `event_signups` n=1, and ticket data comes from 2 ticketing
connections. The original's "requires 2–3 months of post-0.2 data" is optimistic by a phase, because
0.2 does not cause data to exist (D3).

Content otherwise *unchanged from 5.1–5.4 — agree*, including pooled fits, hierarchical fallback,
phase-keyed curves, and the public forecast-accuracy loop, which is the best idea in the original
document.

### Not building (explicit)

Everything in the original §8, **plus**: the HTTP API and MCP surface (D8); marginal-CPS-based
recommendations at current spend (D5); a Google plan adapter (Part 1e, D1); plan-level brief prefill;
and any `campaign_plans` table before checkpoint CC passes.

---

## Recommended first PR

**A.1 — fix the `event_daily_rollups` tickets leg, backfill July–August, and pin it with a regression
test that fails against `85df018`.**

**What it unblocks:** every number in Phase B, and therefore the entire billable reporting tier. Right
now the client-facing dashboard reports **zero tickets sold for the current quarter** while the
ticketing tables hold 19,058 snapshot rows across 76 events for exactly that window. No roadmap in
either document survives a client noticing that first.

It is also the cheapest possible demonstration of the principle both documents already agree on: the
model is only as good as the join underneath it — and right now the join has a hole in it that nobody
knew about.
