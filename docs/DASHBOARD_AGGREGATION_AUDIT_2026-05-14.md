# Dashboard aggregation audit — 2026-05-14

**Author:** Cursor (cursor/audit/dashboard-aggregation-audit-2026-05-14)
**Status:** Investigation only — no code changes in this branch.
**Trigger:** PRs #408 / #409 / #410 / #411 / #412 / #413 / #415 / #416 (2026-05-13 → 2026-05-14) each fixed one aggregation bug on one surface, then Joe reported new wrong numbers on the next surface within hours. We need a systemic map before the Friday demo, not another patch.
**Constraint:** "Real queries, not inference." This Cursor session does not have direct Supabase / Meta Graph credentials. Every "live" number in this doc is either (a) sourced from a recent merged PR / session log and labelled as such, or (b) marked **`[QUERY PENDING]`** with the exact SQL / curl needed to fill it in. Section 1 ships a runbook for the operator with `psql` + `CRON_SECRET` to capture ground truth in one pass.

---

## TL;DR — cover summary

The dashboard has **one underlying data source** (`event_daily_rollups`, `active_creatives_snapshots`, `tier_channel_sales*`, the new `event_code_lifetime_meta_cache` from PR #415) **but at least eight independent aggregator paths** layered on top, each making its own choice about (a) sibling-event N-counting and (b) daily-vs-lifetime concept. Three patterns explain every Joe ticket of the last 72 hours:

| Pattern | What it is | Where PR #410 / #413 / #415 fixed it | Where it still bites |
|---|---|---|---|
| **A. Sibling N-counting** | One Meta campaign value duplicated across the N sibling event rows that share an `event_code` (`[WC26-MANCHESTER]` matches 4 events). Naïve SUM ⇒ N×. | venue stats grid, daily tracker, daily trend chart (#413); funnel pacing BOFU LPV (#410) | **funnel pacing TOFU reach + MOFU clicks** (no dedup); **creative insights tile accumulator** (no dedup); `aggregateVenueCampaignPerformance` raw-spend fallback (defensive only — allocator runs first in prod) |
| **B. Daily-deduped reach summed across days** | `event_daily_rollups.meta_reach` is per-day deduplicated by Meta. Sum over 50 days ≠ 50-day unique reach; it counts a returning user once per day. Compounds with A: 4 siblings × ~2.2× day-overlap ≈ 8.8×. | venue stats grid Reach cell — **swapped to lifetime cache when present** (#415) | venue stats grid when cache row missing (fallback path); **funnel pacing TOFU reach** (still summing); creative insights `total_reach` |
| **C. Concept mismatch (label vs math)** | UI says "Reach" but math computes "sum of daily reach" or "sum of per-creative reach across siblings". | "Reach (sum)" label is honest; #415 added a "Reach" label tied to the cache | funnel pacing TOFU label says "Reach" — math is daily-sum × N siblings; creative-insights tile claims dimension-level "reach" — math sums the same campaign reach N times |

**Bottom line for the unified fix:** every dashboard surface that wants a "campaign-window unique users reached" number must read `event_code_lifetime_meta_cache`. Every surface that wants per-day delivery (clicks, spend, daily impressions) must read `event_daily_rollups` with the PR #413 sibling-dedup pass. Today, only the venue stats grid Reach cell + the venue daily tracker + the venue daily trend chart obey both rules. The other 4–5 surfaces don't.

### Surface × metric reconciliation summary

> Manchester anchor — Joe 2026-05-14:
> - Venue card / Reach (sum): **1,771,635** (yesterday it was 1,740,469 per the PR #415 log; today it's drifted up 31k as new days post; both are sum-of-daily, not lifetime).
> - Funnel pacing / TOFU reach: **6,981,900** (≈ 8.74× lifetime, consistent with N=4 siblings × ~2.2× day-overlap).
> - Meta UI lifetime (`[WC26-MANCHESTER]`): **799,139**.
>
> The PR #415 implementation log pinned the **lifetime cache target at 781,346** (within Meta's ±2% jitter of 799,139). I treat **799,139 as ground truth** in this audit and the cache as "should match within ±2%".

| # | Surface | Metric | Expected (Manchester) | Currently shows | Status | Bug pattern |
|---|---|---|---|---|---|---|
| 1 | `/share/client/[token]` Topline | Reach (sum) cell | n/a — **surface does not exist** today (`<ClientWideTopline>` shows budget/spend/tickets/revenue, no Reach) | n/a | ⚪ N/A | — |
| 2 | `/share/client/[token]` Manchester venue card | Reach / Impressions / Spend / Tickets / Revenue | Reach n/a (card has no Reach cell); Spend & Tickets ≈ ground truth via `aggregateVenueCampaignPerformance` (`ad_spend_allocated`, tier-channel resolver) | Spend ✓ Tickets ✓; **Reach not displayed** on the card | ✅ for what it shows | — |
| 3 | `/share/client/[token]` Brighton venue card | same metrics | same | same | ✅ | — |
| 4 | `/share/venue/[token]?tab=performance` Topline Stats Grid | Reach (sum) / Reach | 799,139 (lifetime) | 781,346 if cache hit (PR #415); **1,771,635** if cache miss (fallback to summed-daily) | ⚠️ Conditional — depends on cache row presence | B (when cache miss) |
| 5 | `/share/venue/[token]?tab=performance` Daily Tracker rows | per-day Spend / Clicks / Tickets / Revenue / CPT | per-day delta values reconciled to allocator + ticket deltas | Reconciles per-day; **does not display Reach or Impressions** | ✅ | — |
| 6 | `/share/venue/[token]?tab=performance` Daily Trend chart | cumulative Tickets / Spend / CPT | running totals from per-day allocator-aware spend + tier-channel ticket deltas | Reconciles. **Chart does not include Reach or Impressions** (only Spend / Tickets / Revenue / CPT / Clicks) | ✅ | — |
| 7 | `/share/venue/[token]?tab=insights` Creative Insights cards | per-tag Spend / LPV / Reach / Impressions / CTR / CPM | tags grouped from `active_creatives_snapshots`. At venue scope (`event_code` filter) all 4 sibling Manchester events feed in; same campaign concept-group `reach`/`impressions`/`spend` is added once per snapshot ⇒ ~4× | Same campaign tile reads ~4× the real value | ❌ | A |
| 8 | `/share/venue/[token]?tab=pacing` TOFU Reach | 799,139 | **6,981,900** | ❌ | A + B (compounded) |
| 9 | `/share/venue/[token]?tab=pacing` MOFU Clicks | per-event link_clicks SUM (allocator-correct after the spend-allocator runs); siblings fall back to N× when allocator hasn't run | reconciles in the typical "allocator has run" steady state; degrades to N× during the cron tick window between Meta-fetch and allocator | ⚠️ Allocator-state dependent | A (during transient cron states) |
| 10 | `/share/venue/[token]?tab=pacing` BOFU LPV | per-event LPV (PR #410's `splitEventCodeLpvByClickShare`) | reconciles | ✅ | — |
| 11 | `/share/venue/[token]?tab=pacing` Sale Outcome (Purchases) | sum of `event_daily_rollups.tickets_sold` (per-event daily delta of provider lifetime cumulative); one row per (event, date) | reconciles | ✅ | — |
| 12 | `/clients/[id]/dashboard` (internal mirror of 1-3) | same | identical render path; same `<DashboardTabs>` ⇒ `<ClientPortal>` ⇒ `<ClientPortalVenueTable>` | identical reconciliation profile to surfaces 1-3 | ✅ for what it shows | — |
| 13 | `/clients/[id]/venues/[event_code]` (internal mirror of 4-7) | same | identical to surfaces 4-7 — same `<VenueFullReport>` + `<CreativePatternsPanel>` + `<FunnelPacingSection>` tree | same reconciliation profile | ⚠️ Stats Grid (cache-state dependent) ❌ Insights ❌ Pacing TOFU | A + B (Insights, Pacing); B (Stats Grid cache-miss) |

**Three categorical bugs ❌ across the 13 surfaces, all attributable to the same two patterns.** The fact that all venue-vs-pacing-vs-insights divergence collapses to A and B is the clean unified-fix opportunity. Section 5 proposes the consolidation.

---

## Section 1 — Source of truth

### Capture procedure (operator runbook)

Two layers of ground truth — one from Meta directly, one from the cache PR #415 just shipped. Both must agree within ±2% for the cache to be trusted.

#### Layer 1 — Meta Graph API (canonical)

The helper `fetchEventLifetimeMetaMetrics` (`lib/insights/meta.ts`, added in PR #415) is exactly the call shape Meta Ads Manager uses for "campaign window deduplicated reach". It hits `/{ad_account_id}/insights` with:

- `level=campaign`
- `date_preset=maximum`
- **no** `time_increment` (that's the deduplication knob — `time_increment=1` would return per-day rows that, summed, are ≥ lifetime by definition)
- `fields=spend,impressions,reach,clicks,actions,action_values`
- post-filter: `campaign.name` contains `[<EVENT_CODE>]` (case-sensitive; the brackets matter)

The fastest way to drive it without writing new code is the existing admin route that PR #415 added:

```
POST https://app.offpixel.co.uk/api/admin/event-code-lifetime-meta-backfill
Authorization: Bearer ${CRON_SECRET}
Content-Type: application/json

{ "client_id": "<4thefans uuid>", "event_code": "WC26-MANCHESTER" }
```

Response body includes the freshly-fetched `meta_reach`, `meta_impressions`, `meta_link_clicks`, `meta_regs`, `meta_engagements`, `meta_video_plays_*`, plus the underlying `campaign_names` matched. **That is the ground truth.**

For the four worst-affected event codes:

```bash
for code in WC26-MANCHESTER WC26-BRIGHTON WC26-LONDON-KENTISH WC26-LONDON-SHEPHERDS; do
  curl -s -X POST "$BASE/api/admin/event-code-lifetime-meta-backfill" \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"client_id\": \"$CLIENT_ID\", \"event_code\": \"$code\"}" | jq .
done
```

For LPV and purchases, lifetime values come from a different shape — Meta returns them as actions inside the same /insights response. The cache extension Q3 in the PR #414 plan covers `meta_link_clicks`, `meta_regs`, `meta_engagements`, `meta_video_plays_*`. **LPV and purchases are not yet in the cache** (PR #415 wired only the columns Meta returns at the top level — see "Cache scope" in `pr-415-creator-venue-lifetime-reach-cache.md`). To fetch them today, hit Graph directly:

```bash
curl -s -G "https://graph.facebook.com/v23.0/$AD_ACCOUNT_ID/insights" \
  --data-urlencode "level=campaign" \
  --data-urlencode "date_preset=maximum" \
  --data-urlencode "fields=campaign_name,spend,impressions,reach,clicks,actions,action_values" \
  --data-urlencode "filtering=[{\"field\":\"campaign.name\",\"operator\":\"CONTAIN\",\"value\":\"[WC26-MANCHESTER]\"}]" \
  --data-urlencode "access_token=$FB_TOKEN" | jq .
```

LPV is `actions[].action_type == "landing_page_view" → value`; purchases is `actions[].action_type == "purchase" → value`; revenue is `action_values[].action_type == "purchase" → value`.

#### Layer 2 — Cache table (sanity check)

Once the backfill route has run, the cache should match Meta within ±2%:

```sql
SELECT event_code,
       meta_reach,
       meta_impressions,
       meta_link_clicks,
       meta_regs,
       meta_engagements,
       fetched_at
  FROM event_code_lifetime_meta_cache
 WHERE client_id = '<4thefans uuid>'
   AND event_code IN ('WC26-MANCHESTER', 'WC26-BRIGHTON',
                      'WC26-LONDON-KENTISH', 'WC26-LONDON-SHEPHERDS');
```

The PR #415 acceptance criteria pinned Manchester ≈ **781,346** against Meta UI's **799,139**. Treat the Meta UI value as the truth and the cache as "fresh enough" within ±2%.

### Source-of-truth slot table

Manchester anchor row is partially populated from prior PR logs and Joe's 2026-05-14 message. Fill the rest with the runbook above.

| event_code | Meta lifetime reach | Meta lifetime impressions | Meta lifetime link_clicks | Meta lifetime spend | Meta lifetime LPV | Meta lifetime purchases | Source / timestamp |
|---|---|---|---|---|---|---|---|
| `WC26-MANCHESTER` | **799,139** (Meta UI, Joe 2026-05-14) — cache target ~781,346 (PR #415 plan) | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | Joe + PR #415 plan |
| `WC26-BRIGHTON` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | needs runbook |
| `WC26-LONDON-KENTISH` | ≈ 331,552 (PR #415 plan acceptance number, pre-merge) | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | PR #415 plan |
| `WC26-LONDON-SHEPHERDS` | ≈ 175,330 (PR #413 acceptance number) | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | `[QUERY PENDING]` | PR #413 plan |

> **Honesty note:** I cannot fetch these from this Cursor session — the SDK has no Supabase service-role key bound to it and Meta tokens live in Vercel env. The runbook above takes ~3 minutes wall-time once an operator has CRON_SECRET in hand. The audit's classification (Section 4) and proposed fix (Section 5) **do not depend on the exact LPV / spend / purchases numbers** — they depend only on the structural pattern (sibling N-counting + daily-summed reach), which is provable from code reading alone.

---

## Section 2 — Dashboard surface map

For every surface listed in the prompt, this section documents (a) the renderer, (b) the data fetcher / loader, (c) the underlying tables and columns, (d) the aggregation method, (e) the current Manchester display value, and (f) the reconciliation status.

> **Note on surface 1.** The prompt asks for `/share/client/[token] — Topline Stats Grid (Reach (sum) cell)`. After tracing the entire client-portal tree (`<DashboardTabs>` → `<ClientPortal>` → `<ClientWideTopline>` + `<ClientPortalVenueTable>`), **no Reach (sum) cell exists on this page today.** `<ClientWideTopline>` shows venue count / event count / tickets sold / marketing budget / marketing spend / ad spend / total spend / tickets sold / ticket revenue / ROAS / additional spend / cost per ticket / sell-through %. The "Reach (sum)" label only renders inside `<VenueStatsGrid>` (PR #413 / #415), which only appears on the `/share/venue/[token]` and `/clients/[id]/venues/[event_code]` routes. Surface 1 is **N/A** today; if Joe needs a client-wide reach number, it has to be built — but the cache-aware shape (Section 5) makes that a small follow-up, not a separate scope.

### Surface map

| # | URL surface · metric | React component (file:line) | Resolver / loader (file:line) | Tables · columns read | Aggregation method | Manchester value (live or pinned) | Status |
|---|---|---|---|---|---|---|---|
| 1 | `/share/client/[token]` — Topline Reach (sum) | n/a — `components/share/client-wide-topline.tsx` (no Reach field) | `lib/db/client-portal-server.ts:loadClientPortalData → loadPortalForClientId` (~L350-470) | `event_daily_rollups`, `events`, `additional_spend_entries`, `weekly_ticket_snapshots`, `tier_channel_sales`, `clients` | n/a (surface absent) | n/a | ⚪ N/A |
| 2 | `/share/client/[token]` — Manchester venue card · Reach / Impressions / Spend / Tickets / Revenue | `components/share/client-portal-venue-table.tsx:VenueSection` (L1718+) → `aggregateVenueCampaignPerformance` | `lib/db/client-dashboard-aggregations.ts:aggregateVenueCampaignPerformance` (L596) + `aggregateVenueWoW` (L1004) | `event_daily_rollups.{ad_spend, ad_spend_allocated, ad_spend_presale, revenue, tickets_sold}`, `events.{capacity, prereg_spend, …}`, `additional_spend_entries`, `tier_channel_sales` (via `resolveDisplayTicketCount`) | per-venue SUM of allocator-correct spend; tickets via `resolveDisplayTicketCount` (Math.max of tier_channel_sales / snapshot / fallback). **Reach + Impressions are NOT rendered on the venue card.** | Spend ✓ Tickets ✓; Reach not displayed | ✅ for what it shows |
| 3 | `/share/client/[token]` — Brighton venue card | same | same | same | same | same | ✅ |
| 4 | `/share/venue/[token]?tab=performance` — Topline Stats Grid · Reach (sum) / Reach (lifetime) cell | `components/share/venue-stats-grid.tsx:VenueStatsGrid` (L104) | `lib/dashboard/venue-stats-grid-aggregator.ts:aggregateStatsForPlatform / All` (L118 / L224); `lib/db/event-code-lifetime-meta-cache.ts` for swap | `event_daily_rollups.{meta_reach, meta_impressions, …}` (post PR #413 dedup); `event_code_lifetime_meta_cache.{meta_reach, meta_impressions}` (PR #415) | sibling-dedup pass (PR #413) → SUM `meta_reach` across days; **swapped to lifetime cache value** when `(platform ∈ {meta, all}) ∧ windowDays === null ∧ cache row present ∧ meta_reach > 0` | ~781,346 if cache hit; **1,771,635** if cache miss (Joe 2026-05-14) | ⚠️ Conditional |
| 5 | `/share/venue/[token]?tab=performance` — Daily Tracker rows | `components/dashboard/events/daily-tracker.tsx` via `components/share/venue-daily-report-block.tsx:VenueDailyTrackerSection` (L423) | `useVenueReportModel → buildVenueReportModel → mergeVenueTimeline` (L618). Inputs: `dedupVenueRollupsByEventCode` (PR #413). | `event_daily_rollups.{ad_spend, ad_spend_allocated, ad_spend_presale, link_clicks, meta_regs, tickets_sold, revenue, tiktok_*, google_ads_*}`, `daily_tracking_entries`, `tier_channel_sales_daily_history`, `ticket_sales_snapshots` | per-day delta values (allocator-aware spend, deduped link_clicks/meta_regs, tier-channel-derived ticket deltas). **Reach + Impressions are NOT in the timeline** (`mergeVenueTimeline` doesn't carry them). | reconciles | ✅ |
| 6 | `/share/venue/[token]?tab=performance` — Daily Trend chart cumulative tickets / spend / CPT | `components/dashboard/events/event-trend-chart.tsx:LegacyTrendChart` (L135) via `VenueTrendChartSection` (L338, venue-daily-report-block) | same `useVenueReportModel`; `cumulativeTicketPoints` from `buildVenueCumulativeTicketTimeline` | same as #5 plus `tier_channel_sales_daily_history` for the cumulative ticket envelope | per-day spend + clicks + revenue from the merged timeline; cumulative tickets from the daily-history envelope. **No Reach / Impressions cell**; Awareness chart variant requires `kind="brand_campaign"` which the venue page never sets. | reconciles for the metrics it exposes | ✅ |
| 7 | `/share/venue/[token]?tab=insights` — Creative Insights cards | `components/dashboard/clients/creative-patterns-panel.tsx:CreativePatternsPanel` (L48) → `components/dashboard/clients/creative-patterns-tiles.tsx:PatternSummaryTile` | `lib/reporting/creative-patterns-cross-event.ts:buildClientCreativePatterns` (L100ish, with `applyRegionFilter` L370) → `fetchLatestSnapshots` (L422) | `active_creatives_snapshots.payload`, `creative_tag_assignments`, `creative_tags`, `event_daily_rollups.{ad_spend, ad_spend_allocated, ad_spend_presale}` (totalSpend computation only) | per `(event_id, snapshot)` iterate concept groups; for each tag dimension `addGroup(acc, …)` does `+= group.spend / group.impressions / group.clicks / group.reach / group.lpv / group.purchases / group.regs`. **No sibling-event dedup.** Venue scope filters events by `event_code === filter.value` — the 4 sibling Manchester events all match — and each event's snapshot carries the same campaign-grain creative metrics. SUM ⇒ ~4× per dimension tile. | every Manchester tile reads ≈ 4× the real Spend / Reach / Impressions / LPV / Purchases | ❌ |
| 8 | `/share/venue/[token]?tab=pacing` — TOFU Reach | `components/dashboard/clients/funnel-pacing-section.tsx:FunnelPacingSection` (L11) → `funnel-stage-card.tsx` (TOFU stage) | `lib/reporting/funnel-pacing.ts:buildClientFunnelPacing` (L103) → `aggregateRollups` (L416) | `event_daily_rollups.{ad_spend, ad_spend_allocated, ad_spend_presale, link_clicks, tickets_sold, meta_reach}` (`fetchRollups` L343) | naïve SUM across all rollup rows: `reach: sum.reach + (row.meta_reach ?? 0)` — **no sibling dedup**, no daily-vs-lifetime collapse. 4 siblings × ~50 days × per-day reach ⇒ ~8.7×. | **6,981,900** vs ground-truth 799,139 | ❌ |
| 9 | `/share/venue/[token]?tab=pacing` — MOFU Clicks | same component | same `aggregateRollups` (L416) | `event_daily_rollups.link_clicks` | naïve SUM across all rollup rows. **The spend-allocator overwrites `link_clicks` to per-event values when it runs**, so in steady state this reconciles. During the cron tick window (Meta-fetch upserts to all 4 sibling rows before allocator runs) it transiently 4×'s. | reconciles in steady state | ⚠️ |
| 10 | `/share/venue/[token]?tab=pacing` — BOFU LPV | same component | `lib/reporting/funnel-pacing.ts:resolveLpvByEventIds` (L463) → `splitEventCodeLpvByClickShare` (PR #410) | `active_creatives_snapshots.payload` (`fetchSnapshotLpvSumByEvent`) + `event_daily_rollups.link_clicks` for the click-share split | per `event_code` group: pick MAX snapshot LPV, then split across siblings by their click share. Sum at venue scope = real campaign LPV. | reconciles | ✅ |
| 11 | `/share/venue/[token]?tab=pacing` — Sale Outcome (Purchases) | same component | `aggregateRollups` (L422 — `purchases: sum.purchases + (row.tickets_sold ?? 0)`) | `event_daily_rollups.tickets_sold` (per-event daily delta) | SUM tickets_sold across rollup rows. `tickets_sold` is the daily-delta of provider lifetime cumulative (`currentSnapshotDailyDelta`) — additive across days and events. | reconciles | ✅ |
| 12 | `/clients/[id]/dashboard` (internal mirror of 1-3) | `app/(dashboard)/clients/[id]/dashboard/page.tsx` (L42) → `<DashboardTabs>` → `<ClientPortal>` → `<ClientPortalVenueTable>` | `lib/db/client-portal-server.ts:loadClientPortalByClientId` | identical to surfaces 1-3 | identical | identical | ✅ for what it shows |
| 13 | `/clients/[id]/venues/[event_code]` (internal mirror of 4-7) | `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` (L70) → `<VenueFullReport>` + `<CreativePatternsPanel>` + `<FunnelPacingSection>` | `lib/db/client-portal-server.ts:loadVenuePortalByCode` (L514) — narrow loader (PR #361) | identical to surfaces 4-11 | identical | identical | ⚠️ stats grid (cache state); ❌ insights; ❌ pacing TOFU |

### Cell-level honesty notes

- **Manchester values** in column "current display": only **#7 Insights** and **#8 Pacing TOFU** are confirmed inflated by Joe's 2026-05-14 numbers. **#4 Stats Grid** can swing between ~781k (cache hit) and ~1.77M (cache miss) depending on whether the `event_code_lifetime_meta_cache` row was upserted by the latest cron tick. **All other ✓ rows** are reconciled by code-reading: every aggregation reads allocator-correct spend (`ad_spend_allocated`) or post-dedup columns (PR #413) or per-event ticket deltas — the math is structurally sound. Where I haven't seen Joe report a wrong number AND the math reads correctly, I mark ✅ rather than fabricate a "live" Manchester value.
- **#9 MOFU Clicks** is the only ⚠️ I'd watch in production: Meta ingest runs ahead of the spend allocator, and a curious viewer hitting the page mid-tick sees 4× clicks momentarily. The dedup helper already exists (`venue-rollup-dedup.ts`) — funnel-pacing just doesn't call it.

---

## Section 3 — Aggregation path inventory (❌ rows only)

### Path P1 — Funnel Pacing TOFU Reach (surfaces #8 / #13)

```
Component:   components/dashboard/clients/funnel-pacing-section.tsx:FunnelPacingSection (L11)
              → components/dashboard/clients/funnel-stage-card.tsx (TOFU card render)
Resolver:    lib/reporting/funnel-pacing.ts:buildClientFunnelPacing (L103)
              → aggregateRollups (L416-426)
              → fetchRollups (L343-356)
DB query:    SELECT event_id, date, ad_spend, ad_spend_allocated, ad_spend_presale,
                    link_clicks, tickets_sold, meta_reach
               FROM event_daily_rollups
              WHERE event_id IN (... live event ids for the venue scope ...)
                AND date >= now() - sinceDays
              LIMIT 10000;
Raw column:  event_daily_rollups.meta_reach
Cron writer: lib/dashboard/rollup-sync-runner.ts (PR #261 / earlier; also touched in PR #415 for the lifetime cache leg)
              → lib/insights/meta.ts:fetchEventDailyMetaMetrics (per-event daily fetch with time_increment=1)
Meta API:    POST /{ad_account_id}/insights
             ?level=campaign
             &date_preset=maximum  (or windowed)
             &time_increment=1     (per-day rows)
             &fields=spend,impressions,reach,clicks,frequency,cpm,actions,action_values
             &filtering=[{"field":"campaign.name","operator":"CONTAIN","value":"[WC26-MANCHESTER]"}]
```

**Why it inflates ~8.74×:** `meta_reach` returned by `time_increment=1` is the per-day deduped reach for the matched campaign(s). Meta returns it once per (campaign, day); the cron writes the SAME per-day value to all 4 sibling Manchester event rows. `aggregateRollups` then SUMs across all 4 events × all ~50 reporting days. Compound factor: 4 (siblings) × ~2.18 (day-overlap, per Joe's 6.98M / 799k / 4 ≈ 2.18) ≈ 8.74×.

**Two distinct fixes required, in the same surface:**
1. **Sibling dedup** — call `dedupVenueRollupsByEventCode` before SUM (same fix shape as PR #413, but in `aggregateRollups`).
2. **Lifetime cache read** — for the TOFU "Reach" stage specifically, the canonical number is `event_code_lifetime_meta_cache.meta_reach` for the venue's `event_code`. Don't sum daily values at all for this metric.

### Path P2 — Creative Insights tile aggregation (surfaces #7 / #13)

```
Component:   components/dashboard/clients/creative-patterns-panel.tsx:CreativePatternsPanel (L48)
              → components/dashboard/clients/creative-patterns-tiles.tsx:PatternSummaryTile
Resolver:    lib/reporting/creative-patterns-cross-event.ts:buildClientCreativePatterns (L100ish)
              → fetchLatestSnapshots (L422)
              → fetchAssignments (L404)
              → addGroup (L559) — SUM into TileAccumulator
DB query:    SELECT event_id, payload, fetched_at, build_version
               FROM active_creatives_snapshots
              WHERE event_id IN (... events scoped by event_code or region ...)
                AND date_preset = 'last_30d' | 'maximum'
              ORDER BY fetched_at DESC
              LIMIT 8000;
Raw column:  active_creatives_snapshots.payload (jsonb; concept-group array)
Cron writer: app/api/cron/refresh-active-creatives/route.ts → lib/reporting/active-creatives-fetch.ts:fetchActiveCreativesForEvent
Meta API:    GET /{ad_account_id}/ads (level=ad)
             then per-campaign /{campaign_id}/insights?level=ad&date_preset=...
             &fields=spend,impressions,reach,clicks,actions,action_values,...
             campaign filter: campaign.name CONTAINS "[<EVENT_CODE>]"
             cross_campaign_duplicates dedup: first-seen ad_id wins WITHIN one event_id (PR #50)
```

**Why it inflates 4×:** the snapshot's `payload.groups[]` carries each creative's `reach / impressions / spend / lpv / purchases / regs` at the level of `(event_id × creative)`. The 4 sibling Manchester events all match the same `[WC26-MANCHESTER]` campaign. Each snapshot therefore carries the SAME creative rows with the SAME numbers. The `addGroup` accumulator at L559 just `+=` for each iteration of `for (const snapshot of snapshots) for (const group of snapshot.payload.groups)` — no `(event_code, creative_id, dimension)` dedup. Result: at venue scope, every dimension tile reads 4× spend, 4× reach, 4× impressions, 4× LPV.

**Fix shape:** in `addGroup` (or a new pre-pass), key the accumulator by `(dimension, value_key, event_code, creative_id)` and only credit a `(creative, event_code)` pair once across the snapshot iteration. The same `splitEventCodeLpvByClickShare` shape from PR #410 generalises if we want the values to land per-event for downstream charts; otherwise a simpler "first-snapshot-wins per (event_code, creative)" works.

### Path P3 — Stats Grid Reach cell, cache-miss fallback (surface #4 / #13)

```
Component:   components/share/venue-stats-grid.tsx:VenueStatsGrid (L104)
Resolver:    lib/dashboard/venue-stats-grid-aggregator.ts:aggregateStatsForPlatform (L118)
              → dedupVenueRollupsByEventCode (PR #413)
              → SUM cells.reach += row.meta_reach
DB query:    SELECT event_id, date, ad_spend, ad_spend_allocated, ad_spend_presale,
                    meta_reach, meta_impressions, meta_video_plays_*, meta_engagements,
                    meta_regs, link_clicks, ...
               FROM event_daily_rollups
              WHERE event_id IN (venue's event_ids)
              ...;
Raw column:  event_daily_rollups.meta_reach (post sibling-dedup)
Render:      VenueStatsGrid (L131-138) — when (platform ∈ {meta,all}) && windowDays === null
              && lifetimeMeta?.meta_reach > 0 → swap to cache value.
              Else: render cells.reach (sum-of-daily-after-sibling-dedup).
Cache writer: app/api/admin/event-code-lifetime-meta-backfill/route.ts (PR #415; also runs from rollup-sync-runner.ts in the cron leg)
Meta API:    same as P1 but **without time_increment** and date_preset=maximum (true lifetime).
```

**Why it intermittently inflates:** PR #415 fixed the headline by routing through a cache, but the swap is conditional. If the cache row is missing (cron hasn't yet upserted, or admin backfill not run), the grid silently falls back to summed-daily-reach (1,771,635) instead of the cache value (~781k). The fallback is wrong by the same daily-summed factor (Bug B).

**Fix shape:** **eliminate the fallback path.** When the cache is the canonical truth, render `—` (or "Updating…") on cache miss rather than a wrong number. Or pre-warm the cache before any read can hit a miss (the rollup-sync-runner does this in the same tick already; the gap is admin-route writes that don't fan out, plus the back-compat undefined `lifetimeMetaByEventCode` that the prop-shape allows for legacy callers).

### Cross-cutting summary

All three ❌ paths share a single root concept failure: **summing per-day or per-event values that Meta has already deduplicated.** The fix is the same in all three: route reach + impressions through the lifetime cache, route per-day metrics (spend, link_clicks, video_plays, regs) through the existing dedup helper, and **never sum daily-deduped values across days**.

---

## Section 4 — Bug categorisation

Every ❌ row from Section 2 mapped to the prompt's A / B / C / D / E categories.

| Surface · metric | Cat A (Sibling N-counting) | Cat B (Daily-reach summed) | Cat C (Wrong source) | Cat D (Concept mismatch) | Cat E (Other) |
|---|---|---|---|---|---|
| #4 Stats Grid Reach (cache-miss fallback) | — | ✓ | ✓ (should read cache, falls back to rollup sum) | ✓ ("Reach (sum)" label is honest about the math but the cell is supposed to be lifetime) | — |
| #7 Insights Reach / Impressions / Spend / LPV / Purchases | ✓ (4× across siblings) | — | — | ✓ (tile labels imply "this concept's reach"; math is "sum of per-snapshot creative reach across siblings") | — |
| #8 Pacing TOFU Reach | ✓ (4× siblings) | ✓ (~2.18× day-overlap) | ✓ (should read cache) | ✓ (label "Reach", math is daily-summed × siblings) | — |
| #9 Pacing MOFU Clicks (steady-state OK, mid-cron-tick degraded) | ✓ (transient during cron tick) | — | — | — | ⚠ Race condition between Meta-fetch and allocator runs |
| #13 internal mirrors | inherits whatever the share surface has | inherits | inherits | inherits | — |

### How the categories show up in the codebase

- **Cat A (Sibling N-counting):** `lib/insights/meta-event-code-match.ts` matches campaigns by case-insensitive substring `[<EVENT_CODE>]`. When 4 sibling events share `WC26-MANCHESTER`, the rollup writer produces 4 identical rows per day for every campaign-grain column. Any consumer that sums across sibling events without the dedup pass over-counts. PR #413 introduced `lib/dashboard/venue-rollup-dedup.ts` to fix this for stats grid + tracker + trend chart; PR #410 introduced `splitEventCodeLpvByClickShare` for funnel-pacing BOFU. The two helpers are complementary but the consumers don't all use one or the other.
- **Cat B (Daily-reach summed across days):** intrinsic to the column definition. `meta_reach` written with `time_increment=1` is a per-calendar-day deduped count; summing N days gives `N × users_who_came_each_day`, not lifetime unique users. There is no "fix in place" — the only correct read is from the lifetime cache (PR #415). Today the venue stats grid Reach cell does this; the funnel pacing TOFU stage and creative insights reach values do not.
- **Cat C (Wrong source):** the stats grid Reach cache-miss fallback reads the rollup sum and labels it as if it were lifetime. The funnel pacing surface should read the cache for TOFU reach but currently reads the rollup. The insights surface should at minimum dedup the snapshot iteration before summing.
- **Cat D (Concept mismatch):** every "Reach" / "Reach (sum)" / "Unique users" label paired with summed-daily math falls into D. PR #415 acknowledged this explicitly in the docblock for `<VenueStatsGrid>`: "Pre-PR #415 the cell summed daily reach values which over-counted by ~2×." The same mismatch exists at #7, #8, #13.
- **Cat E (Other):** only one — the `aggregateRollups` race condition at #9 (Pacing MOFU Clicks). When Meta-fetch upserts before the spend allocator runs, the link_clicks column is the campaign-wide value duplicated across siblings; allocator overwrites to per-event a few seconds later. A page hit during that window 4×s clicks. Mitigated by the existing dedup helper if `aggregateRollups` runs through it; today it doesn't.

### Why this categorisation matters for the unified fix

A and B together cover **every ❌ row.** That means the unified fix doesn't have to discriminate between metrics — it has to discriminate between **scopes** (per-day vs lifetime) and **dedup strategies** (sibling-collapse vs cache lookup). A single helper hierarchy can solve both. Section 5 lays out that hierarchy.

---

## Section 5 — Proposed unified fix shape

### TL;DR

The right shape is **two helpers, not one.** The prompt's hypothesis is `getCanonicalEventMetric(eventCode, metric, scope)`. After tracing the surfaces I'd refine that to:

```ts
// lib/dashboard/canonical-event-metrics.ts (NEW)

/**
 * Single source of truth for event-code-scoped metrics.
 *
 * - `lifetime` metrics MUST come from event_code_lifetime_meta_cache.
 *   These are unique-user / unique-impression numbers that Meta dedupes
 *   inside the campaign window. Summing per-day values for them is
 *   structurally wrong (PR #415's lesson generalised).
 *
 * - `cumulative` metrics come from event_daily_rollups SUMmed across
 *   the venue's events × dates, AFTER dedupVenueRollupsByEventCode.
 *   These are additive (spend, link_clicks, video plays, regs).
 *
 * - `delta` metrics (tickets / revenue) come from per-event
 *   tier_channel_sales_daily_history deltas; the existing resolver
 *   chain (PR #357 / #404) is correct.
 */
export interface CanonicalEventMetrics {
  // lifetime (cache-backed)
  reach: number | null;
  impressions: number | null;
  // cumulative (rollup SUM, sibling-deduped)
  spend: number;
  linkClicks: number;
  videoPlays3s: number;
  videoPlays15s: number;
  videoPlaysP100: number;
  engagements: number;
  metaRegs: number;
  // delta (provider snapshots)
  tickets: number;
  revenue: number | null;
  purchases: number;
  // optional: lifetime LPV (next cache scope expansion)
  lpv: number | null;
}

export async function getCanonicalEventMetrics(
  clientId: string,
  eventCode: string,
  opts?: { windowDays?: ReadonlySet<string> | null },
): Promise<CanonicalEventMetrics>;
```

**Internal implementation:**

1. Lookup `event_code_lifetime_meta_cache.{meta_reach, meta_impressions, meta_link_clicks, meta_engagements, meta_video_plays_*, meta_regs}` for `(client_id, event_code)`. If missing, return `null` for those fields — never fall back to rollup sums (kills Cat B).
2. SUM `event_daily_rollups` filtered to the venue's `event_id` set, after running `dedupVenueRollupsByEventCode` (kills Cat A). Use `ad_spend_allocated ?? ad_spend` for spend (kills allocator-state divergence at Cat E).
3. Read the existing tier-channel resolver chain for tickets / revenue (already correct).

### What gets refactored, what gets deleted

| Today's helper | Disposition under unified fix |
|---|---|
| `lib/dashboard/venue-rollup-dedup.ts` | **Keep, called by getCanonicalEventMetrics internally.** Already a clean module. |
| `lib/db/event-code-lifetime-meta-cache.ts` | **Keep, called by getCanonicalEventMetrics internally.** Already CRUD-only. |
| `lib/reporting/funnel-pacing-payload.ts:splitEventCodeLpvByClickShare` | **Keep**, but only the funnel-pacing BOFU stage will call it (per-event LPV is needed to drive per-event pacing pills). The new top-level helper returns the venue-scope sum directly. |
| `lib/dashboard/venue-stats-grid-aggregator.ts` | **Refactor** — becomes a thin display formatter on top of `getCanonicalEventMetrics`. The `aggregateStatsForPlatform` SUM logic moves into the canonical helper. The platform "All" / "TikTok" / "Google Ads" branching stays in the formatter. |
| `lib/reporting/funnel-pacing.ts:aggregateRollups` | **Delete (or replace).** Replace the body of `buildClientFunnelPacing` to call `getCanonicalEventMetrics` for each in-scope `event_code`, then sum across event_codes (which are independent — no over-counting risk because each cache row is one campaign window). |
| `lib/reporting/creative-patterns-cross-event.ts:addGroup` | **Refactor** — pre-pass the snapshot iteration to dedup `(event_code, creative_id)` pairs first, then accumulate. The resulting tile values become "spend / reach / impressions / LPV / purchases" per dimension at the campaign window — same shape as today, but no longer 4×. |
| `lib/db/client-dashboard-aggregations.ts:aggregateVenueCampaignPerformance` | **Keep.** It already uses `ad_spend_allocated ?? ad_spend` (per-event correct) for spend and the resolver chain for tickets. No reach/impressions involved. |
| `lib/dashboard/wc26-london-split.ts` / `wc26-glasgow-umbrella.ts` | **Keep.** They normalise the rollup `ad_spend_allocated` column for umbrella campaigns. The canonical helper reads `ad_spend_allocated` so this still flows. |

### Effort estimates

| Item | Files touched | Effort |
|---|---|---|
| 5.1 Build `getCanonicalEventMetrics` + tests | 2 new (`canonical-event-metrics.ts` + `__tests__`) | 1.5 days Cursor — pure function, easy to TDD |
| 5.2 Wire funnel-pacing to canonical helper (kills #8 / #13 ❌) | 1 (`lib/reporting/funnel-pacing.ts`) | 0.5 day — replace `aggregateRollups` body, add a per-event_code iteration |
| 5.3 Add `(event_code, creative_id)` dedup to creative-patterns aggregator (kills #7 / #13 ❌) | 1 (`lib/reporting/creative-patterns-cross-event.ts`) | 0.5 day — add a `seen: Set<string>` pre-pass in `addGroup` or a wrapper iterator |
| 5.4 Pre-warm or hard-fail Stats Grid Reach cell on cache miss (kills #4 ❌ fallback) | 2 (`components/share/venue-stats-grid.tsx`, `lib/dashboard/rollup-sync-runner.ts`) | 0.5 day — render `—` on cache miss; ensure the admin backfill route writes for every `(client_id, event_code)` in one pass |
| 5.5 Plumb Stats Grid through canonical helper (replaces ad-hoc aggregator) | 3 (`venue-stats-grid-aggregator.ts`, `venue-stats-grid.tsx`, `client-portal-server.ts`) | 1 day — keeps the current display, but data path collapses |
| 5.6 Add pipeline tests pinning Manchester / Brighton / Kentish / Shepherds at all 4 ❌ surfaces | 4 (`__tests__/`) | 1 day — extend the existing pinning tests from PR #415 |
| 5.7 (Optional, defer) extend cache scope to LPV / purchases | 1 (`event-code-lifetime-meta-cache.ts`, migration) | 0.5 day — additive, schema migration + writer |

**Total: ~5 days for full canonicalisation; ~2 days for the minimum demo-blocker subset (5.2 + 5.3 + 5.4 + smoke tests).**

### Why two helpers (not one)

A single `getCanonicalEventMetric(eventCode, metric)` per call would make the React tree fire ~10× more queries. The two-call shape (`getCanonicalEventMetrics` returns the whole object) batches the cache + rollup SQL roundtrips into one server hop per `event_code`, which matches today's `loadPortalForClientId` shape. Internally the function is one cache `select` + one rollup `select` + one tier-channel call — three queries total per venue scope, which is what the loader already does today.

### What this audit deliberately does NOT propose

- **No new cache table.** The PR #415 `event_code_lifetime_meta_cache` already covers reach + impressions + clicks + regs + engagements + video plays. LPV / purchases extension is a small follow-up (5.7), not a precondition.
- **No deprecation of `event_daily_rollups`.** The rollup table is the right home for additive, per-day metrics. The bug isn't its existence — it's that summing daily-deduped reach across days is conceptually wrong. The canonical helper enforces that rule at the read seam, not the write seam.
- **No DOM smoke harness in this audit.** Section 7 flags it as a follow-up; the existing pipeline-integration test pattern (PR #413 / #415) is the next-best gate and the canonical helper makes those tests trivially extendable.

---

## Section 6 — Joe's flags, sanity-checked

### Flag 1 — "Manchester funnel reach 6.98M vs 1.77M venue card vs 799K Meta UI"

**Confirmed ❌.** Three surfaces, three different numbers, all reading the same underlying Meta data.

| Surface | Number | Audit row | Root cause |
|---|---|---|---|
| Pacing TOFU | 6,981,900 | #8 | Cat A + Cat B compounded — `aggregateRollups` SUMs `meta_reach` across all sibling event rows × all in-window days |
| Stats Grid (cache miss) | 1,771,635 | #4 | Cat B — sibling-deduped (PR #413) but still summed across days |
| Meta UI lifetime | 799,139 | ground truth | n/a |

Math reconciles:
- 1,771,635 / 799,139 ≈ **2.22×** ⇒ pure daily-summed-across-days factor (matches the PR #415 docblock "over-counted by ~2×").
- 6,981,900 / 1,771,635 ≈ **3.94×** ⇒ ≈ 4 (siblings) — funnel pacing has the sibling-N bug ON TOP of the daily-sum bug.
- 6,981,900 / 799,139 ≈ **8.74×** ≈ 4 × 2.18, the compound.

**Fix sequence (Section 7):** ship 5.4 (Stats Grid hard-fail on cache miss) + 5.2 (canonical helper for funnel pacing) before Friday demo.

### Flag 2 — "Sunday recorded 359 tickets — actual or hallucination?"

**Cannot confirm from code-only.** This requires a live query against `ticket_sales_snapshots`. The snapshot writer (`lib/dashboard/rollup-sync-runner.ts:syncTicketingForEvent`) computes a daily delta as `current_lifetime − previous_lifetime` and **explicitly guards against suspicious empty fetches** (`isSuspiciousTicketingZeroFetch`, L1324). So a 359-ticket Sunday delta is NOT a backfill artifact unless multiple syncs ran that day with cumulative changing back and forth.

**Runbook for the operator:**

```sql
-- 1. The actual snapshot rows for Manchester on Sunday 2026-05-11
SELECT s.event_id, e.event_code, e.name,
       s.snapshot_at, s.tickets_sold, s.revenue, s.source
  FROM ticket_sales_snapshots s
  JOIN events e ON e.id = s.event_id
 WHERE e.event_code = 'WC26-MANCHESTER'
   AND s.snapshot_at::date = '2026-05-11'
 ORDER BY s.event_id, s.snapshot_at;

-- 2. The rollup row's tickets_sold for that day vs the previous day
SELECT r.event_id, e.name,
       r.date, r.tickets_sold AS daily_delta,
       r.source_eventbrite_at, r.updated_at
  FROM event_daily_rollups r
  JOIN events e ON e.id = r.event_id
 WHERE e.event_code = 'WC26-MANCHESTER'
   AND r.date BETWEEN '2026-05-10' AND '2026-05-12'
 ORDER BY r.event_id, r.date;
```

If the rollup row's `tickets_sold` for 2026-05-11 sums to 359 across siblings AND the snapshot diff between Saturday and Sunday equals 359, the number is real. If the snapshot diff is materially different (e.g. 50, with 309 hallucinated), you've found a backfill artefact and we have a bigger problem.

**Live cross-check:** call the 4thefans connector for Manchester's external IDs and compare the current cumulative against `ticket_sales_snapshots.tickets_sold` for the latest snapshot. The cumulative should equal the latest snapshot value. If not, smoothing in `lib/dashboard/tier-channel-smoothing.ts` may have edited the timeline.

### Flag 3 — "Brighton Central Park large discrepancies"

**Confirmed in pattern, magnitude unknown without queries.**

Brighton (`WC26-BRIGHTON`, Central Park venue) has the same multi-fixture footprint as Manchester (4 WC fixtures sharing one bracketed code). Therefore Brighton inherits **every ❌ row from the surface map** at the same compound factor (~4× sibling × daily-sum). The Brighton stats grid is identical in shape to Manchester's; the funnel pacing TOFU reach should be ~4×–8× the lifetime; the creative insights tile should be ~4× the per-creative truth.

**The shape of the bug is identical for any venue with multi-fixture coverage** under one bracketed code. The fix in Section 5 closes Manchester, Brighton, all four London venues with bracketed codes (Tottenham / Shoreditch / Kentish / Shepherd's Bush), and any future multi-fixture venue (Edinburgh, Bristol, Glasgow umbrellas) in one shot.

### Flag 4 (Cursor-spotted) — Stats Grid intermittent reach drift

I'd flag this for Joe / Matas: between the time the operator opens `/share/venue/<token>` and reloads it after the cron tick, the Reach cell can flip from 1.77M (cache miss) to ~781k (cache hit) without any UI explanation. A viewer who reloads will think "the number changed" — the surface gives no indication that one of those values is the correct one. Fix 5.4 (hard-fail on cache miss) closes this.

### Flag 5 (Cursor-spotted) — Glasgow venue cards will under-count reach

Per the PR #415 session log: "Glasgow venue cards will show LOWER reach post-merge than they did pre-merge. The Glasgow daily helper folds the WC26-GLASGOW umbrella spend into venue siblings via date-based attribution; the lifetime helper does NOT." This is **intentional** under the PR #415 model ("venue cards show only bracket-matching campaigns") — but if Joe sees Glasgow Hampden's reach drop relative to last week, that's expected, not a regression. Document in the demo notes.

### Flag 6 (Cursor-spotted) — Daily Tracker reach absence

If Joe expects to see a "Reach" column in the Daily Tracker rows, he won't find one. `mergeVenueTimeline` doesn't carry `meta_reach` / `meta_impressions` / `meta_video_plays_*` / `meta_engagements` into the timeline, so the Tracker can only show spend / clicks / regs / tickets / revenue per day. This is a feature, not a bug — daily reach is rarely meaningful — but worth noting in case a question arises.

### Flag 7 — "Manchester England v Croatia 2026-05-13 rollup tickets_sold=1, but snapshot delta 247→254 = 7"

**Joe's hypothesis:** `isSuspiciousTicketingZeroFetch` (PR #403) is over-skipping legitimate writes.

**Verdict: hypothesis refuted. PR #403's guard is inert here.** The guard at `lib/dashboard/ticketing-zero-fetch-guard.ts:33` fires only when `currentLifetime === 0 && previousLifetime > 0`. Both 247 and 254 are positive — the guard has no opinion on this fetch and lets it through. Confirmed by re-reading the guard signature and PR #403's session log ("only fires when `currentLifetime === 0` AND `previousLifetime > 0`. A genuine first-sync zero (null previous) and a genuine equal-day zero (previous also 0) are both allowed through").

**What is actually happening (likely):** The runner's "previous snapshot" lookup uses `getLatestSnapshotForLinkBeforeDate` (`lib/db/ticketing.ts:542`), which returns the **most recent snapshot strictly before today 00:00 UTC** — not the start-of-yesterday value. Because the cron runs hourly (or near-hourly), 4thefans accumulates intra-day snapshots like:

```
Mon 2026-05-12 06:00 UTC → 240
Mon 2026-05-12 12:00 UTC → 244
Mon 2026-05-12 18:00 UTC → 247   ← what Joe is reading
Mon 2026-05-12 23:30 UTC → 253   ← what the runner picks as "previous"
Tue 2026-05-13 06:00 UTC → 254
```

When the Tuesday 06:00 sync runs:
- `currentTotal = 254`
- `previousSnapshot.tickets_sold = 253` (most recent < 2026-05-13T00:00:00Z, picked by `.order("snapshot_at", desc).limit(1)`)
- `currentSnapshotDailyDelta(254, 253) = 1`
- Tuesday's rollup row written with `tickets_sold = 1`

That `1` is the **correct since-last-snapshot delta**. The "missing 6" sales (247 → 253) were already written to **Monday's** rollup row earlier on Monday evening — they aren't lost. Joe is comparing two non-adjacent snapshots (the morning of day-1 vs the morning of day-2) and expecting the system to write that span as Tuesday's delta, but the system writes adjacent-snapshot deltas — which is the only way to avoid double-counting Monday's sales.

This is a Cat D (Concept Mismatch) issue, not a backfill bug. The **rollup row's tickets_sold is correctly the delta from the last pre-today snapshot** — but the **per-day daily-tracker semantic** (which a viewer reads as "total tickets sold on Tuesday") is undefined when there are multiple intra-day snapshots in the previous day. Pick one of two repair models:

1. **Day-aligned semantic** — define yesterday's "last" as `snapshot_at::date = today − 1 INTERVAL DAY ORDER BY snapshot_at DESC LIMIT 1` and Today's "first" as `snapshot_at::date = today ORDER BY snapshot_at ASC LIMIT 1`. The intra-day delta on the previous day (last-of-day minus first-of-day) gets attributed entirely to yesterday; today's row gets the cross-midnight delta.
2. **Cumulative-truth semantic** — store `tickets_sold_cumulative` per day in the rollup (last snapshot of the day), let the Daily Tracker subtract neighbouring days at read time. This collapses the multi-snapshot intra-day uncertainty.

Both models change the meaning of `event_daily_rollups.tickets_sold` and need a coordinated rewrite + a backfill across all 4thefans events. **Defer to a dedicated PR** — it is independent of the reach / N-counting work in Sections 5–7. It is **not a Friday demo blocker** (numbers reconcile to within ±1 ticket per day, and the lifetime totals across multi-day spans are correct).

**Runbook for the operator (verify the diagnosis):**

```sql
-- 1. List EVERY snapshot for the Manchester England v Croatia event_id on 2026-05-12 and 2026-05-13.
--    Look for >1 row per day. The "last < 2026-05-13T00:00:00Z" row is what the runner reads as "previous".
SELECT s.snapshot_at, s.tickets_sold, s.gross_revenue_cents, s.source, s.connection_id, s.external_event_id
  FROM ticket_sales_snapshots s
  JOIN events e ON e.id = s.event_id
 WHERE e.event_code = 'WC26-MANCHESTER'
   AND e.name ILIKE '%Croatia%'
   AND s.snapshot_at >= '2026-05-12T00:00:00Z'
   AND s.snapshot_at <  '2026-05-14T00:00:00Z'
 ORDER BY s.snapshot_at;

-- 2. The corresponding rollup rows. The Mon row should be ~6 (240→247?) or ~13 (240→253),
--    Tue row should equal (254 − last-pre-Tue-snapshot).
SELECT r.date, r.tickets_sold AS daily_delta, r.revenue,
       r.source_eventbrite_at, r.updated_at
  FROM event_daily_rollups r
  JOIN events e ON e.id = r.event_id
 WHERE e.event_code = 'WC26-MANCHESTER'
   AND e.name ILIKE '%Croatia%'
   AND r.date BETWEEN '2026-05-11' AND '2026-05-13'
 ORDER BY r.date;
```

If Query 1 shows multiple snapshots on 2026-05-12 with the latest being 253 (or any value > 247), the diagnosis above is confirmed and **PR #403 is not at fault**. If Query 1 shows only one snapshot on 2026-05-12 at value 247, then there is a separate bug to investigate (probably in the runner's snapshot insert path skipping today's first write).

**Secondary candidate to rule out** — multi-link aggregation. If the Manchester England v Croatia event has multiple ticketing links (e.g. one 4thefans listing per ticket category) and one of those links wrote a partial delta of 1 while another link's delta was 6 but errored before merging, the rollup would land at 1. The runner's `mergeDailyTicketsRow` path adds across links into the same date bucket (`lib/dashboard/rollup-sync-runner.ts:889`), so a single failed link mid-loop would leak the partial sum. Check the runner logs around the Tuesday sync for `firstError` warnings tagged with `WC26-MANCHESTER`. The current code has a `firstError ??= message; continue;` pattern that does NOT abort the rollup write — so a partial-merge tickets_sold=1 outcome is possible if the first sibling link returned 1 and the second errored.

**What I checked and ruled out:**
- `isSuspiciousTicketingZeroFetch` cannot fire when current > 0 (verified at `lib/dashboard/ticketing-zero-fetch-guard.ts:33`).
- `currentSnapshotDailyDelta(254, 247)` returns 7 (verified at `lib/ticketing/current-snapshot-delta.ts`); the only way the runner writes 1 from a 247-base is if the "previous" snapshot it reads is 253, not 247.
- PR #404's `rollup-pre-pr395-backfill` filter is `r.date < PRE_PR395_CUTOFF` (i.e. `< 2026-05-08`); it cannot touch the 2026-05-13 row.
- `upsertEventbriteRollups` at `lib/db/event-daily-rollups.ts:345` does a per-(event_id, date) UPSERT (replaces, not adds) — so no double-write accumulation.
- The admin `fourthefans-rollup-backfill` route (`app/api/admin/fourthefans-rollup-backfill/route.ts`) protects pre-existing positive `tickets_sold` rows via `protectedDates` — it cannot demote a 7 to a 1.

---

## Section 7 — Recommended sequence

### Friday demo blockers (must ship by 4pm UK Friday)

1. **Pre-warm the lifetime cache for every `(client_id, event_code)` 4thefans owns.**
   Run the existing admin route once for each venue:
   ```
   POST /api/admin/event-code-lifetime-meta-backfill
   { "client_id": "<4thefans uuid>" }   // populates every event_code under the client in one pass
   ```
   The route is idempotent and fast (one Meta call per `event_code`). After this, surface #4 (Stats Grid Reach cell) reconciles to ~781k for Manchester, ~175k for Shepherd's Bush, ~331k for Kentish — no code change needed.
   **Cost:** 5 minutes wall-time. **Risk:** zero — the cache is read-only on the share path; populating it cannot regress anything.

2. **Ship 5.2 (canonical helper for funnel pacing TOFU Reach).**
   Replace `aggregateRollups` in `lib/reporting/funnel-pacing.ts` with a per-event_code loop that reads the lifetime cache for `reach`, deduped rollup SUM for `clicks` / `spend` / `purchases`. Keep the existing LPV split (PR #410) for BOFU. Two-file PR (funnel-pacing.ts + a pipeline test pinning Manchester to 799,139 ±2%).
   **Cost:** ~0.5 day. **Risk:** medium — funnel pacing benchmark numbers will change for every multi-fixture venue.

3. **Ship 5.4 (hard-fail Stats Grid Reach cell on cache miss).**
   In `<VenueStatsGrid>`, when the cell would render the rollup-sum fallback, render `—` with a tooltip "Computing — refresh in a moment" instead. Removes the 1.77M / 781k flip-flop.
   **Cost:** ~2 hours.

That's the minimum demo unblock — Manchester reaches all reconcile to 799k ±2% across stats grid, funnel pacing, and the venue card. Shepherd's Bush, Kentish, and Brighton inherit the same fix.

### Demo-shippable next, can defer to next week

4. **Ship 5.3 (creative insights `(event_code, creative_id)` dedup).**
   Tile values for multi-fixture venues drop to the per-campaign truth. Materially affects the "best concept" ranking — current rankings are stable order but inflated magnitude. ~0.5 day.

5. **Ship 5.5 + 5.6 (refactor Stats Grid through canonical helper + pipeline tests).**
   Aligns the cleanest surface with the new helper, and pins Manchester / Brighton / Kentish / Shepherds at every ❌ surface so a future regression breaks loudly. ~1.5 days.

### Defer until after demo

6. **5.7 — extend cache to LPV / purchases.** Today these go through the funnel-pacing snapshot resolver (PR #410) and the per-event ticket-delta path; both are correct. The extension is "future-proofing" rather than bug-fix. ~0.5 day.

7. **DOM smoke test harness (Playwright).** Memo'd in `feedback_resolver_dashboard_test_gap.md`; would have caught the Stats Grid cache-miss flip-flop pre-merge. ~0.5 day standalone, ~2 days for a full set of 5 representative scenarios.

8. **Document the canonical helper as the entry point for new dashboards (Junction 2 / Boiler Room onboarding).** The 5-day total cost above is mostly amortised for new clients: every new venue surface routes through the same helper, no per-client aggregator code.

### Sequence summary

| Day | Items | Owner | Risk | Outcome |
|---|---|---|---|---|
| Thu pm | (audit handoff to Matas) | Cursor → Matas | none | greenlight or pivot |
| Thu pm / Fri am | Item 1 (cache pre-warm) | ops (curl) | zero | Stats Grid Reach reconciles |
| Fri am | Item 2 (canonical helper, funnel pacing only) | Cursor / cc | medium | Pacing TOFU Reach reconciles |
| Fri pm | Item 3 (hard-fail Stats Grid) | cc (small) | low | flip-flop killed |
| Fri 4pm | Joe demo | Joe / Matas | n/a | reach numbers tell one consistent story |
| Mon-Tue | Items 4, 5 | Cursor | medium | insights + stats grid through canonical helper |
| Wed | Item 6 (cache extension) | cc | low | LPV / purchases canonical |
| Thu | Item 7 (DOM smoke harness) | Cursor | low | regression-protected |

### What I'd ask Matas to decide on Thursday afternoon

1. **Greenlight Items 1-3** for Friday demo? They unblock the most visible surfaces.
2. **Approve the two-helper shape** in Section 5 (`getCanonicalEventMetrics` returns a struct, not per-call) before Cursor starts Item 2 — once the canonical helper exists, the rest of the consolidation is straightforward.
3. **Defer Item 6** (LPV / purchases cache extension) to next week — confirm.
4. **Confirm the Glasgow under-count behaviour** (Flag 5 in §6) is acceptable for the demo — if not, scope a Glasgow umbrella tile (PR #415's deferred follow-up).

---

## Appendix — file references for the unified fix

| Concern | File |
|---|---|
| Sibling dedup helper | `lib/dashboard/venue-rollup-dedup.ts` (PR #413) |
| Lifetime cache CRUD | `lib/db/event-code-lifetime-meta-cache.ts` (PR #415) |
| Lifetime cache writer (cron) | `lib/dashboard/rollup-sync-runner.ts` (lifetime leg) |
| Lifetime cache writer (admin) | `app/api/admin/event-code-lifetime-meta-backfill/route.ts` |
| Lifetime fetch helper | `lib/insights/meta.ts:fetchEventLifetimeMetaMetrics` |
| Per-event LPV split | `lib/reporting/funnel-pacing-payload.ts:splitEventCodeLpvByClickShare` (PR #410) |
| Spend allocator | `lib/dashboard/venue-spend-allocator.ts` |
| Funnel pacing aggregator | `lib/reporting/funnel-pacing.ts:aggregateRollups` (the ❌ path) |
| Creative insights aggregator | `lib/reporting/creative-patterns-cross-event.ts:addGroup` (the ❌ path) |
| Stats grid aggregator | `lib/dashboard/venue-stats-grid-aggregator.ts` (the partial-fix path) |
| Stats grid component | `components/share/venue-stats-grid.tsx` (cache-swap logic) |
| Daily tracker / trend chart | `components/share/venue-daily-report-block.tsx` (already correct) |
| Client portal venue table | `components/share/client-portal-venue-table.tsx` (no Reach displayed; already correct for what it shows) |
| Client portal loader | `lib/db/client-portal-server.ts:loadClientPortalByClientId / loadVenuePortalByCode / loadVenuePortalByToken` |

---

## Appendix — context already in the repo

| Doc | What it covers | Why it matters here |
|---|---|---|
| `docs/PLAN_VENUE_REACH_AND_LONDON_UMBRELLA_2026-05-13.md` | Plan PR #414 — the architectural decision behind the lifetime cache | Establishes the cache as canonical for unique-user metrics |
| `docs/session-logs/pr-413-creator-venue-over-attribution-audit.md` | Sibling N-counting dedup helper | Established pattern A as a fixable class |
| `docs/session-logs/pr-415-creator-venue-lifetime-reach-cache.md` | Lifetime cache implementation | Establishes pattern B fix for stats grid; this audit extends to other surfaces |
| `docs/feedback_resolver_dashboard_test_gap.md` | Memory anchor — resolver tests don't catch wire-up bugs | Justifies pipeline-integration tests as the next-best gate (no DOM harness yet) |
| `docs/DASHBOARD_BUILD_AUDIT_2026-05-09.md` | Whole-stack audit before this multi-PR arc | Identified `client-portal-venue-table.tsx` (2,710 lines) and `loadClientPortalByClientId` (1,584 lines) as oversized; the canonical helper is one piece of unwinding that |

> The five "memory anchors" the prompt asked me to read first (`feedback_collapse_strategy_per_consumer.md`, `feedback_snapshot_source_completeness.md`, `feedback_multi_link_backfill_scope.md`, `feedback_layered_fix_pattern.md`, `feedback_resolver_dashboard_test_gap.md`) — only the last exists as a standalone file in `docs/`. The other four are referenced by the 2026-05-09 audit (`DASHBOARD_BUILD_AUDIT_2026-05-09.md`) but never landed as standalone docs. I read the resolver-test-gap anchor in full and absorbed the spirit of the other four from the build-audit; if the project wants those four spelled out, they can be derived from the existing PR session logs in 1 hour by Cursor.
