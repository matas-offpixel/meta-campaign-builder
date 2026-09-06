# Dashboard Truth Audit — 2026-06-04

**Branch:** `cursor/dashboard-truth-audit-2026-06-04` · **Mode:** AUDIT-ONLY (no code changed) · **Verified on `main` HEAD** (`a3d6ac3`).

Per `feedback_audit_first_when_layered_fixes_emerge` and `feedback_verify_premises_before_mega_prompts`. Several prompt premises were **wrong** and are corrected below with grep + Supabase evidence.

---

## TL;DR — what actually broke (and what didn't)

| Premise in prompt | Verdict | Evidence |
|---|---|---|
| Bug A: PRESALE-overlap venues **under**-report ~£3,800 total | **WRONG — they OVER-report ~£1,350–1,400 EACH** | `ad_spend_presale` is added on top of `ad_spend_allocated`; the 6 presale venues each overshoot truth by ≈ their presale column. See Surface 6. |
| Bug D: London-Presale dashboard shows **£0** | **PARTLY WRONG** | £878.26 **is** in DB (`events.meta_spend_cached` + `ad_spend_presale`). It's dropped from the **Topline** (`client-portal.tsx:200` passes only `londonOnsaleSpend`) and has **no venue card** (split out of `events`). |
| Bug G: Reach/Click/LPV 200–488% inflated **client-facing** | **MOSTLY MITIGATED** | Client surfaces (`venue-stats-grid`, funnel, perf-summary) read the **dedup'd lifetime cache**, not the daily SUM. Daily-SUM inflation is real in the DB but only shows on cache-miss (labeled "Reach (sum)"). |
| Bug H: Manchester +43 = manual topup contaminating daily tracker | **CONFIRMED as a risk, mechanism corrected** | Topup went to `ticket_sales_snapshots` (source=`manual`), NOT `tier_channel_sales_daily_history`. daily_history (cron) takes per-date priority, so the contamination is **cron-timing / lifetime-tile**, not the corroborated tracker delta. |
| Fix proposal: switch daily tracker to `ticketing_purchase_events` | **NOT VIABLE AS-IS** | `ticketing_purchase_events` is **EMPTY (0 rows globally)**. No ingestion exists. |
| Edinburgh funnel £7,346 vs truth £7,801 (under) | **STALE/WRONG** | Live `sumVenueSpend` = allocated £7,391.88 + presale £1,345.74 = **£8,737.62 → OVER truth by £937**. |

**Net:** the dominant drift on `main` today is **over-reporting of spend** on presale-overlap + Glasgow venues (allocator/presale magnitude), not under-reporting. The portfolio raw `allocated+presale` sum is **£86,479 vs truth £75,815 (+£10,664 / +14%)**.

---

## Live spend table — dashboard `effective_paid` (`SUM(ad_spend_allocated)+SUM(ad_spend_presale)`) vs truth

Source: Supabase `event_daily_rollups` joined to `events`, client `37906506-…561a`, 2026-06-04.

| event_code | allocated | presale | dashboard effective | truth | drift |
|---|--:|--:|--:|--:|--:|
| ABERDEEN | 2,833.94 | 448.65 | **3,282.59** | 3,257 | +26 ✓ |
| BIRMINGHAM | 3,757.30 | 1,760.36 | **5,517.66** | 4,159 | **+1,359** |
| BOURNEMOUTH | 3,588.92 | 1,783.28 | **5,372.20** | 3,987 | **+1,385** |
| BRIGHTON | 7,250.95 | 1,704.52 | **8,955.47** | 8,836 | +119 ✓ |
| BRISTOL | 3,402.15 | 1,764.68 | **5,166.83** | 3,817 | **+1,350** |
| EDINBURGH | 7,391.88 | 1,345.74 | **8,737.62** | 7,801 | **+937** |
| GLASGOW-O2 (pre-split) | 8,231.43 | 0 | **8,238.51** | 6,478 | (split-adjusted at render) |
| GLASGOW-SWG3 (pre-split) | 2,702.89 | 1,342.56 | **4,049.26** | 2,854 | (split-adjusted at render) |
| LEEDS | 3,366.76 | 1,795.88 | **5,162.64** | 3,776 | **+1,387** |
| LONDON-KENTISH | 4,590.23 | 0 | **4,590.23** | 4,565 | +25 ✓ |
| LONDON-ONSALE | 995.48 | 0 | **1,665.15** | 2,145 | -480 |
| LONDON-PRESALE | 0 | 878.26 | **878.26** | 878 | ✓ (but dropped from Topline) |
| LONDON-SHEPHERDS | 2,109.45 | 0 | **2,109.45** | 2,080 | +29 ✓ |
| LONDON-SHOREDITCH | 2,993.08 | 0 | **2,993.08** | 2,954 | +39 ✓ |
| LONDON-TOTTENHAM | 1,872.99 | 0 | **1,872.99** | 1,847 | +26 ✓ |
| MANCHESTER | 9,466.17 | 1,084.97 | **10,551.14** | 10,423 | +128 ✓ |
| MARGATE | 1,695.68 | 289.20 | **1,984.88** | 1,968 | +17 ✓ |
| NEWCASTLE | 3,509.07 | 1,841.56 | **5,350.63** | 3,951 | **+1,400** |

**Pattern:** the 8 venues with **no presale column** (or tiny) match truth within ±£130. The 6 venues with a large `ad_spend_presale` (Birmingham, Bournemouth, Bristol, Leeds, Newcastle, +Edinburgh) overshoot truth by ≈ their presale amount. This is the smoking gun for Bug A (see Surface 6).

---

# Surface 1 — Topline / Internal dashboard headline

## Data flow
`app/(dashboard)/clients/[id]/dashboard/page.tsx:62` → `loadClientPortalByClientId` → `components/share/client-portal.tsx:196` `aggregateAllBuckets(events, dailyRollups, additionalSpend, londonOnsaleSpend ?? 0)` → `lib/db/client-dashboard-aggregations.ts:295` `aggregateClientWideTotals` → `ClientWideTopline` (`client-wide-topline.tsx:109` "Ad spend"/"Total spend").

## Which helper aggregates portfolio spend?
**Not** `sumLifetimePaidMediaSpend` (that name exists only in docs — premise wrong). It is `aggregateClientWideTotals` (`client-dashboard-aggregations.ts:295`). It iterates `event_daily_rollups` per row (`:376`) via `clientWidePaidSpendOf` (allocator-aware: `ad_spend_allocated ?? ad_spend` + `ad_spend_presale` + TikTok/GA), with multi-event-code dedup (`:380-391`), then `adSpend += extraAdSpend` (`:393`).

## Umbrella spends
- **ONSALE £1,729.60 (cached):** included via `extraAdSpend = londonOnsaleSpend` (`client-portal.tsx:200`, applied `client-dashboard-aggregations.ts:393`). Stale vs truth £2,145 (-£415).
- **PRESALE £878.26:** **DROPPED.** `londonPresaleSpend` is never passed (`client-portal.tsx:200,202` — not in args or deps). And the PRESALE synthetic row is split out of `events` (`client-portal-server.ts:719-726`), so its `ad_spend_presale` is not summed either. Net £878 missing from the headline.

## Current value (Edinburgh, the cleanest multi-fixture venue)
Topline is portfolio-only; Edinburgh's contribution = allocated £7,391.88 + presale £1,345.74 = **£8,737.62**. **Truth £7,801 → +£937 over.**

## Drift origin
- `components/share/client-portal.tsx:200` — `londonPresaleSpend` omitted (Bug D at topline).
- `lib/db/client-dashboard-aggregations.ts:393` + presale column (Bug A propagates here).

## Fix shape
- **Patch:** thread `londonPresaleSpend` into `aggregateAllBuckets`/`extraAdSpend` (recovers £878). Low risk.
- **Architectural:** fix presale double-attribution upstream (Surface 6) — that's where the +£10.6k portfolio overshoot lives.

## Estimated PRs
2 — `cursor/dashboard-fix-s1-presale-umbrella-topline` (patch) + the shared allocator PR from Surface 6.

---

# Surface 2 — Venue Report (per-event page)

## Data flow
`app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` (+ `app/share/venue/[token]/page.tsx`) → `loadVenuePortalByCode/Token` → `buildVenueCanonicalFunnel({ dailyRollups, lifetimeCacheRow, spendAdjustmentGbp: getSpendAdjustmentGbp(eventCode) })` (`page.tsx:232-240` / `:153-161`) → `FunnelPacingSection` + `venue-stats-grid`.

## Which helper reads single-venue spend?
`sumVenueSpend` inside `buildVenueCanonicalFunnel` (`venue-canonical-funnel.ts:429,902-916`): `SUM(ad_spend_allocated + ad_spend_presale)`, raw `ad_spend` fallback only when `allocated` is null.

## Glasgow split
**Yes** — `getSpendAdjustmentGbp(eventCode)` is applied at `venue-canonical-funnel.ts:429` and seeded into reconciliation at `:612`. Threaded from both venue pages (internal `:240`, share `:161`). Engagement split via `applyAdsetSplitsToLifetimeMeta` on the cache row.

## London-Presale venue card
There is **no DB event missing** — the PRESALE event exists with `meta_spend_cached=878.26` and `ad_spend_presale=878.26`. The issue is it's **deliberately excluded** from the rendered venue list (`client-portal-server.ts:719-726`), so there is no `/venues/WC26-LONDON-PRESALE` card. Premise "£0 / no mapping" is wrong; it's "intentionally hidden umbrella".

## Brighton "£1,723 gap"
Not reproduced on `main`. Brighton dashboard effective = allocated £7,250.95 + presale £1,704.52 = **£8,955.47 vs truth £8,836 → +£119 over** (not −£1,723 under). Premise stale.

## Drift origin
`lib/dashboard/venue-spend-allocator.ts` (read-only) magnitude for presale venues; `venue-canonical-funnel.ts:429` faithfully sums what the allocator wrote.

## Fix shape
Architectural (allocator/presale) — shared with Surface 6. Venue page itself needs no change.

## Estimated PRs
0 dedicated (covered by Surface 6 allocator PR). Optional: `cursor/dashboard-fix-s2-presale-venue-card` if a visible London-Presale card is desired.

---

# Surface 3 — Performance Summary table

## Data flow
`components/share/client-portal-venue-table.tsx` `VenueSection` (`:1719`) → `displayVenueSpend` (`:728-746`, allocator `venuePaidMedia`) → **+`getSpendAdjustmentGbp`** (`:1749`, applied `:1748-1752`) → `aggregateVenueCampaignPerformance(..., venueDisplaySpend)` (`:1753-1762`, override = 6th arg) → CPT pill (`:1997`).

## Per-row spend source
Allocator rollup spend (`ad_spend_allocated ?? ad_spend` + presale + TikTok, `client-dashboard-aggregations.ts:716-726` / `paid-spend.ts:8-35`), **overridden** by `venueDisplaySpend` (always passed today). Glasgow adjustment applied **before** the aggregator. Not the lifetime cache for spend (cache has no spend column — see below).

## Does `applyAdsetSplitsToLifetimeMeta` adjust spend?
**No.** `event_code_lifetime_meta_cache` has **no spend column** (verified: columns = reach/impressions/link_clicks/regs/video/engagements/LPV only). The split helper adjusts **engagement only**; spend is adjusted separately via `getSpendAdjustmentGbp` at the funnel + venue-table layer.

## Relationship to `getCanonicalEventMetrics` (PR #418)
**None.** This file has zero imports of `canonical-event-metrics`; PR #418 explicitly scoped it out.

## Reach/Click/LPV on this table
**Not rendered here at all** (no `lifetimeMetaByEventCode` prop; return object `:783-800` is spend/tickets/revenue only). Engagement lives on `venue-stats-grid` (Surface 7). So **Bug G does not hit the Performance Summary table.**

## Current value (Edinburgh)
CPT pill = `venueDisplaySpend` ÷ tickets = £8,737.62 ÷ 4,278 ≈ **£2.04** (truth CPT £1.82, because spend is £937 over). Spend itself = **£8,737.62 vs truth £7,801**.

## Drift origin
Same allocator/presale magnitude (`venue-spend-allocator.ts`, read-only). The component math is correct.

## Fix shape / PRs
Architectural (shared Surface 6 allocator PR). 0 dedicated component PRs.

---

# Surface 4 — Funnel Pacing

## Data flow
`buildVenueCanonicalFunnel` (`lib/dashboard/venue-canonical-funnel.ts`) → `funnel-pacing-section.tsx:54` → `funnel-pacing-venue-view.tsx`. (No `components/share/funnel-pacing-*`; venue + share both use the dashboard components.)

## Builder + spend
`buildVenueCanonicalFunnel`. Headline spend `:429` `sumVenueSpend(dailyRollups) + (spendAdjustmentGbp ?? 0)`; helper `:902-916` = `SUM(allocated + presale)`, raw fallback when allocated null. Reconciliation tile `computeSpendReconciliation` (`:522-617`) uses the **stricter** `(allocated ?? 0)+(presale ?? 0)` with NO raw fallback.

## spendAdjustmentGbp for Glasgow
**Yes** — accepted (`:406-414`), applied to headline (`:429`) + reconciliation seed (`:612`). Threaded from both venue pages.

## Multi-fixture venues
Per-fixture daily rows for the `event_code` are **summed**, not fanned out — `allocated`/`presale` are already per-fixture. Raw `ad_spend` is campaign-wide-duplicated across fixtures, but the builder only falls back to raw when `allocated` is null (`:910`), and reconciliation never uses raw. Loader scopes rollups to the venue's fixture `event_id`s with **no date filter** (`client-portal-server.ts:1493-1507`). Edinburgh (3 fixtures): allocated sums to £7,391.88 — correct sum, no duplication.

## Engagement source
Dedup'd **lifetime cache** (`:422-425` `cache?.meta_reach/meta_link_clicks/meta_landing_page_views`), tagged `lifetime_cache`/`cache_miss` (`:570-576`). **Not** the daily SUM → Bug G does not hit the funnel.

## 60-day cap?
The builder applies **no** date cap (only 14-day sub-windows for pace/spend-series). The 60-day cap is on the **write** side (`rollup-sync-runner.ts:397-407`), not the read. Historical days persist if they were ever written (see Surface 6 for the backfill caveat).

## Current value (Edinburgh)
Headline spend **£8,737.62 vs truth £7,801 (+£937)**. Prompt's "£7,346 / under" is **stale** on `main`.

## Drift origin / Fix / PRs
Allocator/presale magnitude (read-only). 0 dedicated funnel PRs; shared Surface 6.

---

# Surface 5 — Daily Tracker / Daily Sales delta (NEW PRIORITY)

## Data flow
`components/share/venue-daily-report-block.tsx` `buildVenueReportModel` → `mergeVenueTimeline` (`:620-758`) → `DailyTracker`. Per-day tickets come from `buildCorroboratedDailyDeltas` (`venue-trend-points.ts:652`) over `tier_channel_sales_daily_history` cumulative (`buildVenueDailyHistoryTimelines:418`) when `hasDailyHistory`; else the `ticket_sales_snapshots` snapshot-envelope (`:728-753`). Trend-chart line `cumulativeTicketPoints` (`:168`) is **always** the snapshot envelope, but daily_history takes **per-date priority** inside `buildEventCumulativeTicketTimeline:146-156`.

## "Tickets today" derivation
`cumulative(D) − cumulative(D−1)`, clamped ≥ 0, **gated** by a corroboration check: a positive delta only surfaces if `event_daily_rollups` has ticket/revenue activity within ±1 day of the true sale day (`corroboratedDailyDeltas:586-617`). `manual_backfill`-source history rows bypass the gate (`MANUAL_SOURCE_KINDS:519`); `cron`/`smoothed_historical` do not.

## Manchester +43 on Jun 4 — is it client-facing? Mechanism CORRECTED
The topup was inserted into **`ticket_sales_snapshots`** with `source='manual'` (verified: manual Jun-4 sum = **1,001** across 4 fixtures). It did **NOT** enter `tier_channel_sales_daily_history`. Manchester **has** daily_history (190 rows, latest 2026-06-04, `source_kind='cron'`; cum Jun3=1,431 → Jun4=1,450, delta +19). So:
- The **corroborated tracker delta** for Jun 4 reads daily_history (+19, legitimate cron sales), NOT the topup.
- daily_history takes per-date priority in the **trend chart** too, so on dates daily_history covers, the manual snapshot is overridden.
- **Therefore the +43 the client saw is best explained by (a) cron-timing** — the report was viewed after the SQL topup but *before* the Jun-4 daily_history cron row landed, so the snapshot-envelope's manual=1,001 was the only Jun-4 signal and surfaced as a step — **and/or (b) the lifetime tile** day-over-day (958 → 1,001 = **+43**), which uses `resolveDisplayTicketCount` (manual > eventbrite priority) and reflects the topup immediately.

`source='manual'` in `ticket_sales_snapshots` is **not** the same as `source_kind='manual_backfill'` in `tier_channel_sales_daily_history`, so it neither bypasses nor is excluded from the snapshot-envelope corroboration path → it **can** leak as a phantom delta during the cron-gap window. This is the real Bug H exposure.

## Does ANY surface use `ticketing_purchase_events`?
**No — and the table is EMPTY (0 rows globally, 0 for 4theFans WC26).** The prompt's proposed fix (switch to `ticketing_purchase_events`) is **not viable** without first building per-order ingestion. **Premise corrected.**

## Edinburgh 2026-06-03 daily-delta vs purchase-events
Not comparable — `ticketing_purchase_events` is empty, so there is no per-order ground truth to diff against. The tracker delta for Edinburgh uses cron daily_history corroborated by rollups.

## Drift origin
- Phantom-delta exposure: `ticket_sales_snapshots` manual rows feed `buildEventCumulativeTicketTimeline` (`venue-trend-points.ts:124-132`) and are not excluded from the corroboration path — exposure during the daily_history cron gap.
- Lifetime-tile day-over-day: `resolveDisplayTicketCount` (`tier-channel-rollups.ts`) immediately reflects manual topups.

## Fix shape
**Architectural-ish (medium):** treat reconciliation/manual `ticket_sales_snapshots` rows as **cumulative anchors, not daily-sale signal**:
1. Exclude `source IN ('manual','xlsx_import')` rows from per-day **delta** derivation (keep them for the lifetime tile + envelope ceiling), OR
2. Add a `reconciliation`/`is_topup` flag so the delta builder re-bases without emitting.
A move to `ticketing_purchase_events` is the right **long-term** source but requires an ingestion build first (not this quarter).

## Estimated PRs
2 — `cursor/dashboard-fix-s5-daily-tracker-suppress-manual-deltas` (delta exclusion + tests) and later `cursor/ticketing-purchase-events-ingest` (long-term).

---

# Surface 6 — Per-day spend (Meta daily)

## Data flow
`event_daily_rollups.ad_spend` (raw, fanned across fixtures) / `ad_spend_allocated` (per-fixture split) / `ad_spend_presale` (presale, even-split across same-venue events) → all readers use `allocated + presale` (`paid-spend.ts:8-22`, `venue-canonical-funnel.ts:902-916`, `client-dashboard-aggregations.ts:380-393`).

## Bug A — CORRECTED: over-report, not under-report
The 6 presale venues overshoot truth by ≈ their `ad_spend_presale` column (see live table). Birmingham +£1,359 (presale £1,760), Bournemouth +£1,385 (£1,783), Bristol +£1,350 (£1,765), Leeds +£1,387 (£1,796), Newcastle +£1,400 (£1,842), Edinburgh +£937 (presale £1,346). The 8 venues with no presale column match truth within ±£130.

**Hypothesis (needs allocator-owner confirm — file is read-only):** presale-period spend is split across same-venue events into `ad_spend_presale` AND is also (partly) represented in the per-venue Meta truth differently — i.e. presale spend is **double-attributed**: once to the venue via the even-split and once it should sit under the `WC26-LONDON-PRESALE`/umbrella bucket. Per-day overlap of `allocated>0 AND presale>0` = **0 days for Edinburgh** (verified), so it is NOT a same-day double count; it is a **bucket-level over-attribution** of the presale total.

## 60-day window truncation?
Write-side cap is 60 days (`rollup-sync-runner.ts:397-407`); read-side has no cap. Historical pre-window days exist only if backfilled (PR #494 legacy backfill). For presale venues the historical rows are clearly **present** (presale column is populated) — so the problem is the opposite of truncation: too much presale is attributed, not too little.

## Current value (Aberdeen 2026-06-04)
Aberdeen is the closest match (effective £3,282.59 vs truth £3,257, +£26) — its presale column is small (£448.65). Confirms the presale-magnitude hypothesis.

## Drift origin
`lib/dashboard/venue-spend-allocator.ts` (presale even-split / generic-share), read-only. Writer: `rollup-sync-runner.ts` presale bucket.

## Fix shape
**Architectural.** Requires allocator owner. Likely: stop adding presale to per-venue effective spend when the presale total is already represented in the umbrella truth, or cap presale attribution. Highest-£-impact fix.

## Estimated PRs
1–2 — `cursor/dashboard-fix-s6-presale-overattribution` (allocator/writer, owner-gated, needs Meta-MCP reconciliation per venue).

---

# Surface 7 — Reach / Click / LPV display

## Data flow
Client-facing engagement lives on `components/share/venue-stats-grid.tsx` (venue full report) + the funnel (Surface 4), both reading `event_code_lifetime_meta_cache` via `lifetimeMetaByEventCode` (adjusted by `applyAdsetSplitsToLifetimeMeta` for Glasgow). The Performance Summary table does **not** render reach/LPV (Surface 3).

## Is the client-facing number inflated?
**Mostly no — already mitigated (PR #415).** `venue-stats-grid.tsx:170-179` prefers the dedup'd lifetime-cache reach (`showLifetimeReach`); only on cache-miss does it fall back to summed daily reach, **explicitly labeled "Reach (sum)"** with a disambiguating tooltip (`:315-317`). The WC26 cache is populated, so clients see dedup'd reach.

## How inflated IS the daily SUM (for context)?
Verified cache (dedup) vs `SUM(event_daily_rollups.meta_reach)`:

| venue | cache reach | daily-summed reach | ratio |
|---|--:|--:|--:|
| BRIGHTON | 566,452 | 3,635,742 | 6.4× |
| EDINBURGH | 814,026 | 4,489,903 | 5.5× |
| GLASGOW-O2 | 1,027,125 | 4,797,167 | 4.7× |
| MANCHESTER | 1,324,163 | 3,074,550 | 2.3× |

So the inflation is real **in the raw column**, but readers don't use it for reach. Clicks/LPV are messier (cache clicks can be higher or lower than the daily sum depending on fetch windows) but the same cache-first rule applies.

## Current value (Edinburgh)
Reach shown = **814,026 (dedup cache)**, correct-shape. Daily-sum would be 4.49M (not shown unless cache-miss).

## Drift origin
None client-facing while cache is fresh. Residual risk: cache-miss fallback to summed reach. `venue-stats-grid.tsx:175-179`.

## Fix shape
**Patch (low priority):** on cache-miss, show `—` instead of summed reach (or keep the explicit label). Optional.

## Estimated PRs
0–1 — optional `cursor/dashboard-fix-s7-reach-cache-miss-dash`.

---

# Surface 8 — Channel coverage gaps

## Is there venue-channel ingestion (O2 / SWG3 / SeeTickets)?
**No.** Ticketing providers are CHECK-constrained to `eventbrite` / `fourthefans` / `manual` / `foursomething_internal` (per CLAUDE.md + `client_ticketing_connections.provider`). There is no O2 Academy / SWG3 / SeeTickets adapter or cron. The live cron was **never** wired to pick up venue-channel sales. The Glasgow O2 (+403), SWG3 (+794), Manchester (+66) topups (PR #530) are the only path.

## Right shape
Recommended: **(a) keep manual topups but make them durable** — the current ad-hoc SQL is exactly what contaminated Surface 5. Specifically:
1. Tag reconciliation rows so the daily-tracker delta builder excludes them (Surface 5 fix), AND
2. Add a small **"venue-channel sales added separately"** disclosure on surfaces that show lifetime tickets, so the topup isn't mistaken for a daily sale.
A full per-channel ingest (b) is only worth it if venue-channel volume keeps growing; SeeTickets has an API, O2/SWG3 likely do not.

## Other venues with external-channel gaps?
The topups so far cover Glasgow O2/SWG3 + Manchester. Brighton/Bristol/Margate were **not** topped up; whether they have venue-channel gaps is unverified here (the audit baseline truth tickets for those venues should be cross-checked against `ticket_sales_snapshots` lifetime in a follow-up — out of audit scope, no client venue-channel figure provided).

## Fix shape / PRs
Process + small UI. 1 — `cursor/dashboard-fix-s8-external-channel-disclosure` (bundled with Surface 5 reconciliation-tagging).

---

# Bugs A–H — confirm / correct with evidence

| Bug | Stated | Verdict | Evidence |
|---|---|---|---|
| **A** | PRESALE-overlap legacy spend **not captured** (~£3,800 under, 8 venues) | **INVERTED** | Presale venues **over**-report by ≈ their `ad_spend_presale` (Birmingham +£1,359, Newcastle +£1,400, …). `ad_spend_presale` IS captured and ADDED on top of allocated. Portfolio +£10,664 over. (Surface 6 table.) |
| **B** | Allocator under-share — Brighton −£1,723, London-Onsale −£1,155 | **PARTLY WRONG** | Brighton **+£119 over** (£8,955 vs £8,836). London-Onsale **−£480** (£1,665 vs £2,145) — under, but ≈£480 not £1,155 (and ONSALE topline uses stale cached £1,729). |
| **C** | Glasgow CAMPAIGN_SPLITS stale — RESOLVED by #530 | **CONFIRMED resolved** | `event-code-adset-splits.ts` snapshot = 2026-06-03 (O2 0.7853 / SWG3 0.2147). Applied at funnel `:429` + venue-table `:1749`. |
| **D** | London-Presale shows £0 vs truth £878 | **MECHANISM CORRECTED** | £878.26 IS in DB. Dropped from **Topline** (`client-portal.tsx:200` omits `londonPresaleSpend`) + **no venue card** (`client-portal-server.ts:719-726`). Not "£0 in DB". |
| **E** | Glasgow venue-channel tickets — audit whether cron should ingest | **CONFIRMED no ingest** | No O2/SWG3 provider exists; topups are manual-only (Surface 8). |
| **F** | Manchester SeeTickets external sales — same | **CONFIRMED no ingest** | Same as E; manual topup (Surface 8). |
| **G** | Reach/Click/LPV per-day SUM 200–488% inflated client-facing | **MOSTLY MITIGATED** | Raw column inflated 2.3–6.4× (Surface 7 table), but client readers use the dedup'd cache (`venue-stats-grid.tsx:170-179`, funnel `:422-425`). Summed value only on labeled cache-miss. |
| **H** | Daily delta contaminated by reconciliation writes; Manchester +43 = topup | **CONFIRMED (mechanism corrected)** | Topup is in `ticket_sales_snapshots` source=`manual` (Jun-4 sum 1,001), NOT daily_history. The corroborated tracker reads daily_history (+19). +43 = cron-gap snapshot leak and/or lifetime-tile day-over-day (958→1,001). Exposure: manual snapshots not excluded from envelope/corroboration path. |

---

# Cross-surface findings

- **One root cause dominates (presale over-attribution, Bug A/B/D/Surface 6).** It hits Topline, Venue Report, Performance Summary, and Funnel Pacing simultaneously because all four read `allocated + presale` from `event_daily_rollups`. Fixing the allocator/writer once cascades to all spend surfaces. This is the **highest-£ fix** (+£10.6k portfolio).
- **The lifetime-cache architecture already solved Bug G** — engagement surfaces converged on the dedup'd cache (PR #415/#418). No new work needed beyond an optional cache-miss tidy.
- **Surface 5 / Bug H is independent** of spend — it's a ticket-delta source-hygiene problem. The corroboration architecture (PR #378/#438) is sound; the gap is that ad-hoc `manual` `ticket_sales_snapshots` topups aren't classified as reconciliation, so they can leak as phantom deltas in the daily_history cron gap and they move the lifetime tile day-over-day. **Do NOT add more SQL topups** until the delta builder excludes reconciliation rows (`feedback_no_fallback_papering_over_broken_source`).
- **`sumLifetimePaidMediaSpend` (PR #460) does not exist in live code** — the canonical reader is `paid-spend.ts` + `aggregateClientWideTotals`. Update mental model.
- **`ticketing_purchase_events` is empty** — any plan that depends on it (per-order daily truth, real attribution per day) is blocked on ingestion.

## Recommended PR sequence (client-impact × eng-cost)

| # | PR branch | Surface/Bug | Impact | Cost | Owner |
|---|---|---|---|---|---|
| 1 | `cursor/dashboard-fix-s5-daily-tracker-suppress-manual-deltas` | S5 / H | High (client trust; stops phantom sales) | Low–Med | Cursor |
| 2 | `cursor/dashboard-fix-s1-presale-umbrella-topline` | S1 / D | Med (+£878 + ONSALE refresh on headline) | Low | Cursor |
| 3 | `cursor/dashboard-fix-s6-presale-overattribution` | S6 / A,B | **Highest £ (+£10.6k)** | High (allocator owner, Meta-MCP recon) | cc/owner-gated |
| 4 | `cursor/dashboard-fix-s8-external-channel-disclosure` | S8 / E,F | Med (sets expectations) | Low | Cursor |
| 5 | `cursor/dashboard-fix-s7-reach-cache-miss-dash` (optional) | S7 / G | Low | Low | Cursor |
| 6 | `cursor/ticketing-purchase-events-ingest` (long-term) | S5 source | Med (enables true per-day) | High | later |

Suggested order: **1 → 2 → 4** (quick, safe, restore client trust) then **3** (the big allocator fix, owner-gated) and **5/6** opportunistically.

---

# Daily-tracking fix proposal (Surface 5 + Bug H)

**Do NOT switch to `ticketing_purchase_events` yet — it is empty (0 rows).** Proposed concrete fix:

1. **Classify reconciliation rows.** Treat `ticket_sales_snapshots.source IN ('manual','xlsx_import')` (or a new `is_reconciliation`/`external_event_id LIKE '%topup%'` marker) as **cumulative anchors only**. In `buildEventCumulativeTicketTimeline` (`venue-trend-points.ts`), let these rows raise the envelope ceiling (so lifetime totals stay correct) but **never emit a per-day delta**.
2. **Exclude from the corroboration delta grid.** In `corroboratedDailyDeltas` / `buildCorroboratedDailyDeltas`, add reconciliation snapshot dates to a *suppress* set (the inverse of `MANUAL_SOURCE_KINDS` bypass) so a manual jump re-bases without surfacing — closing the cron-gap leak.
3. **Stabilise the lifetime tile.** Keep `resolveDisplayTicketCount` reflecting the topup for the lifetime number, but ensure the day-over-day "delta" widget reads the corroborated daily series, not lifetime-tile differences.
4. **Add a disclosure** ("+N venue-channel tickets added 2026-06-04") instead of letting topups masquerade as organic daily sales.
5. **Long-term:** build `ticketing_purchase_events` ingestion (SeeTickets API where available) for true per-order per-day counts, then migrate the tracker source. Separate, larger effort.

Tests: extend `lib/dashboard/__tests__/corroborated-daily-deltas.test.ts` with a manual-topup-row fixture asserting **zero** daily delta + correct lifetime envelope.

---

# Anti-drift compliance

- **No code modified.** Only this doc added. Verified on `main` HEAD.
- **No rollup SQL-UPDATEs.** Only read-only `SELECT`s run (Bug H makes writes worse).
- **No guessed line numbers** — every `file:line` was read/grepped on `main`.
- **No CAMPAIGN_SPLITS-style overrides proposed** for surfaces 1–8.
- **`venue-spend-allocator.ts` + `lib/insights/meta.ts` read-only** — flagged as the Surface 6 fix locus for the owner; not touched.
- **Premises verified** — 5 prompt premises corrected (Bug A direction, Bug D £0, Bug G client-facing, `ticketing_purchase_events`, Edinburgh £7,346).

