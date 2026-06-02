# WC26 Dashboard vs. Excel Cross-Reference Audit

**Generated:** 2026-05-29  
**Source of truth:** `WC26_funnel_cross_reference.xlsx`  
**Comparison target:** Dashboard Funnel Pacing + Performance Summary + Today + Allocation views (live Supabase state)

---

## TL;DR — by category

| Category | Issues found | Action required |
|---|---|---|
| **Data corrections (Supabase writes)** | 4 | SQL UPDATE per venue |
| **Dashboard formula bugs (code PRs)** | 4 | Cursor PRs |
| **Feature gaps (Excel has, dashboard doesn't)** | 6 | Cursor PRs (Funnel Pacing tab + new section) |
| **Architectural divergences** | 3 | Strategic decisions before code |

Net total: **17 distinct issues** across 18 venues.

---

## CATEGORY 1 — Data corrections (Supabase writes)

These are facts the dashboard reads from Supabase that don't match what Matas verified in the Excel. Fix with direct `UPDATE` via Supabase MCP, no code change needed.

### 1.1 Capacity mismatches (15 of 18 venues affected)

The Excel uses **venue-level total capacity** (sum across all fixtures). Supabase `events.capacity` is **per-fixture only**. Every WC26 venue's dashboard currently undercounts capacity.

| Venue | Excel cap | DB shared_capacity (per fixture) | Need to update DB to |
|---|---|---|---|
| Aberdeen | 3,240 | 1,189 | Need per-fixture distribution or new col |
| Birmingham | 3,075 | 432 | Need per-fixture distribution |
| Bournemouth | 2,768 | 520 | Need per-fixture distribution |
| Brighton | 10,250 | 3,082 | Need per-fixture distribution |
| Bristol | 2,706 | 818 | Need per-fixture distribution |
| Edinburgh | **5,478** | 2,140 | Update to venue total |
| Glasgow O2 | 6,750 | 693 | Need per-fixture distribution |
| Glasgow SWG3 | 4,080 | 1,092 | Need per-fixture distribution |
| Leeds | 3,957 | 577 | Need per-fixture distribution |
| Kentish | 4,715 | 423 | Need per-fixture distribution |
| Shepherds | 2,060 | 400 | Need per-fixture distribution |
| Shoreditch | 2,132 | 1,015 | Need per-fixture distribution |
| Tottenham | 2,411 | 1,022 | Need per-fixture distribution |
| Manchester | 8,200 | 5,052 | Need per-fixture distribution |
| Margate | 1,538 | 595 | Need per-fixture distribution |
| Newcastle | 4,100 | 700 | Need per-fixture distribution |

**Strategic question:** Do per-fixture capacities sum to venue capacity (e.g. Edinburgh 5,478 = 2,140 + 1,838 + 1,500), or is `events.capacity` meant to be venue-total replicated? The funnel pacing math depends on which. Funnel Pacing currently uses `aggregateSharedVenueBudget()` = MAX per code; should match for capacity.

**Recommended fix:** Either:
- (a) **Update events.capacity to MAX(per-fixture) per event_code = venue total** (simplest, matches dashboard's `MAX` reads)
- (b) **Distribute capacity per-fixture by attendance breakdown**, then dashboard sums (more accurate but requires new logic)

→ Lean toward (a): single SQL UPDATE per venue replaces `events.capacity` with the venue total.

### 1.2 Edinburgh tickets

| Source | Edinburgh tickets |
|---|---|
| Excel "4tF API" | 3,873 |
| DB events.tickets_sold | 3,901 (post-resolveVenueTicketsSold) |
| Dashboard reads | 3,901 |

**Off by 28 tickets** because Excel was snapped earlier. Excel needs updating, NOT dashboard. Minor.

### 1.3 Brighton tickets

| Source | Brighton TRUE TOTAL |
|---|---|
| Excel TRUE TOTAL | 2,567 |
| DB true_total | 2,575 |
| Dashboard reads | 2,575 |

Off by 8. Same Excel-staleness issue.

### 1.4 Manchester tickets

| Source | Manchester TRUE TOTAL |
|---|---|
| Excel | 1,348 |
| DB | 1,350 |
| Dashboard | 1,350 |

Off by 2. Same.

→ **Action 1.A:** Single SQL UPDATE setting `events.capacity` to the venue-level total per event_code, replicated across all fixtures. Manchester goes 5,052 → 8,200, Brighton 3,082 → 10,250, etc.

→ **Action 1.B:** Excel needs ticket counts refreshed from Supabase post-action 1.A (or just accept the staleness — the gaps are <0.5% and within rounding).

---

## CATEGORY 2 — Dashboard formula bugs (code PRs)

These are calculations the dashboard does that produce wrong outputs because the underlying formula has architectural issues, not data issues.

### 2.1 Spend per event_code is severely under-reported on dashboard vs Meta direct

Dashboard reads from `event_daily_rollups.ad_spend_allocated + ad_spend_presale` per event_code. Excel uses Meta Ads Manager direct via Meta MCP. The gap is consistent and large:

| Venue | Dashboard spend | Excel spend (Meta direct) | Δ | % under |
|---|---|---|---|---|
| Aberdeen | £640 | £2,442 | -£1,802 | **74% under** |
| Birmingham | £624 | £3,370 | -£2,746 | **81% under** |
| Brighton | £2,609 | £6,694 | -£4,085 | **61% under** |
| Edinburgh | £2,345 | £7,024 | -£4,679 | **67% under** |
| Manchester | £6,581 | £8,355 | -£1,774 | 21% under |
| Glasgow O2 | £3,097 | £5,130 | -£2,033 | 40% under |
| Kentish | £1,224 | £3,697 | -£2,473 | 67% under |
| Tottenham | £839 | £1,465 | -£626 | 43% under |
| ... | ... | ... | ... | (all venues similar) |
| **TOTAL** | **~£24,664** | **£62,595** | **-£37,931** | **61% under** |

**Root cause analysis:**
- 4thefans WC26 has 110+ campaigns, only 12-13 reach the allocator per cron tick (Finding #3 from PR #481 verification — cron 800s timeout)
- Allocator output → `ad_spend_allocated` column
- Dashboard reads ALLOCATED, not raw `ad_spend`
- Raw `ad_spend` IS in DB (Aberdeen raw = £1,894 per query earlier, Aberdeen Meta-direct = £2,440 with paused campaigns added) but dashboard doesn't use it

**Existing fix in flight:** PR #483 (allocator dedupe) reduces work by ~14×. Still likely missing campaigns that were PAUSED at time of rollup-sync.

→ **Action 2.A:** Audit why paused/inactive campaigns aren't being aggregated. Verify `rollup-sync-events` cron filter on campaign status. Likely it's only including ACTIVE campaigns; should include ALL campaigns under the event_code regardless of status because their lifetime spend still counts toward CPT/budget.

→ **Action 2.B:** Once fixed, re-fire `/api/admin/event-rollup-backfill?force=true` to repopulate. Dashboard spend should match Excel within £100/venue.

### 2.2 CPT is computed at wrong scope on Edinburgh

| Source | Edinburgh CPT |
|---|---|
| Dashboard | £0.60 |
| Excel | £1.81 |
| Performance Summary | £1.83 (per PR #478 fix) |

Funnel Pacing reads `liveCostPerTicket = spent / ticketsSold`. With dashboard spend understated at £2,345 but tickets at 3,901, CPT computes to £0.60. Excel correctly reads £7,024 / 3,873 = £1.81.

→ **Fixed automatically by Action 2.A.** No separate code change needed — once spend is correct, CPT computes correctly.

### 2.3 Days-until-event uses MIN not MAX (regression risk — already fixed in PR #486)

Excel uses MAX(event_date) per event_code. Dashboard should now match per #486. Verification needed:

| Venue | Excel days_left | DB MAX(event_date) - today |
|---|---|---|
| Aberdeen | 26 | 26 ✓ |
| Edinburgh | 26 | 26 ✓ |
| Brighton | 33 | 33 ✓ |
| Tottenham | 33 | 33 ✓ |

✓ All match. #486 successful.

### 2.4 Funnel Pacing's "required-per-day" doesn't show, dashboard suggests wrong number

The Excel's "Required spend (at current CPT)" / days_left = Suggested daily spend (e.g. Aberdeen £831/day). Dashboard's Funnel Pacing tab shows `requiredPerDay` from canonical funnel which is the same calc.

| Venue | Excel sug. daily | Dashboard sug. daily (was) |
|---|---|---|
| Aberdeen | £831 | £218 (before allocator fix) |
| Brighton | £607 | £574 |
| Manchester | £1,287 | £368 |
| Tottenham | £1,769 | £138 |

**Cause:** Same as 2.1 — dashboard reads wrong spend → wrong CPT → wrong required-per-day. **Fixed by Action 2.A.**

---

## CATEGORY 3 — Feature gaps (Excel has, dashboard doesn't)

Things in the Excel that have strategic value but aren't visible in the dashboard yet. Each = a small PR.

### 3.1 Glasgow Combined aggregate row
**Excel:** Shows `WC26-GLASGOW (Combined)` row aggregating O2 + SWG3 + shared campaigns.  
**Dashboard:** Each venue is independent. No combined view.

→ **Feature PR:** Add a "Multi-venue rollup" option on the client dashboard. Could be just for Glasgow now; pattern would extend to any client where one event_code has split spend.

### 3.2 Run Rate Projection (avg-daily-sales × days_remaining)
**Excel:** 7 columns (avg/day, projected, projected %, +15/25/35/50% surge × 2). Capacity-based surge model.  
**Dashboard:** Funnel Pacing has a `forwardProjection` chart but it's CPT-based, not sales-rate-based.

→ **Feature PR:** Add a sales-rate projection section to Funnel Pacing tab. Show baseline + 4 surge scenarios. Use capacity × uplift% model from Excel.

### 3.3 CPT at sellout = (Current spend + Required spend at current CPT) / Capacity
**Excel:** Shows blended per-ticket cost at full sellout, projecting remaining sales at the current efficiency level.  
**Math:** Mathematically reduces to current CPT for every venue (because projecting at current CPT means CPT@sellout = current CPT). The value as a separate column is the explicit confirmation that the venue's current efficiency, if maintained, will yield this blended cost across all capacity.  
**Dashboard:** Not visible as a labelled output.

→ **Feature PR:** Add the "if you maintain current CPT all the way to sellout, blended cost = £X.XX per ticket" line on Funnel Pacing's "Spend vs Budget Reconciliation" card. Helps frame whether the venue's budgeted CPT (£2.50 anchor on most venues, £1.81 on Edinburgh) is achievable at current efficiency.

### 3.4 Suggested budget increase + Suggested daily spend
**Excel:** Required spend - Remaining allocated = how much more to inject. Then ÷ days_remaining = recommended daily uplift.  
**Dashboard:** Funnel Pacing shows "Required/day" but doesn't break out "vs. current" or "additional needed."

→ **Already partially in dashboard.** Just needs the "additional needed" delta to be more prominent.

### 3.5 Live Daily Budget (Meta API, sum of active ad set daily_budget)
**Excel:** Shows current sum from Meta MCP for every active ad set.  
**Dashboard:** Shows live Meta daily budget via `getDailyBudgetUpdate` cache, BUT only on Funnel Pacing (one venue at a time). No portfolio view.

→ **Feature PR:** Add a sortable column to the client dashboard's stats table showing live daily budget per venue.

### 3.6 4tF vs Box Office ticket source breakdown
**Excel:** Shows both `events.tickets_sold` (4tF API) and `tier_channel_sales` SUM (Box Office) as separate columns + their MAX as TRUE TOTAL.  
**Dashboard:** Uses resolveVenueTicketsSold (MAX) but doesn't show the breakdown.

→ **Feature PR:** Add a tooltip or expandable detail showing the split. Useful for diagnostic ("Manchester sold 1,348 tickets — 849 via 4tF API + 499 venue-direct box office").

---

## CATEGORY 4 — Architectural divergences (strategic decisions)

These need a decision before code.

### 4.1 Budget anchored at £2.50 CPT across portfolio
**Excel finding:** Every venue's `budget_marketing` is exactly `capacity × £2.50`. Edinburgh is the only exception (anchored at £1.81).  
**Implication:** The dashboard's allocator and Spend vs Budget reconciliation already trust this. No bug, but worth surfacing in client conversations.

→ **Strategic surfacing:** Add a "£/ticket budget benchmark" indicator to Funnel Pacing that shows `Allocated / Capacity = £2.50` to make the implicit budget rule explicit.

### 4.2 Per-fixture vs per-venue spend attribution
**Excel:** Glasgow O2's £6,562 TRAFFIC campaign has mixed O2 + SWG3 ad sets. Excel does ad-set-level reallocation (74.5% to O2, 25.5% to SWG3).  
**Dashboard:** Does not yet support ad-set-level attribution within a single campaign. The whole campaign attributes to its bracketed event_code only.

→ **Decision:** Should the dashboard add ad-set-level attribution? This is the bigger architectural lift. Two options:
- (a) **Yes:** Build the same logic Excel uses. ~2-day Cursor PR.
- (b) **No, push rule on Meta side:** Require ad sets to live in event-code-specific campaigns from now on. Easier policy, harder retroactive.

### 4.3 Capacity numbers in Excel include the venue total, DB has per-fixture
Already covered in 1.1 but worth reframing: **the dashboard's funnel pacing math is fundamentally based on the wrong scope** (per-fixture) when Matas's mental model is venue-level. Decision: should funnel pacing be per-fixture (Brazil game has its own funnel) or per-venue (Edinburgh as a whole has one funnel)?

→ **Strategic decision needed.** Current PR #486 et al. assume per-venue (MAX dates, MAX budgets). Capacity should match → it should be venue total. This is the cleanest mental model.

---

## ORDER-OF-OPERATIONS RECOMMENDATION

**Today / tomorrow:**

1. **Action 1.A**: SQL update capacity per venue (4-5 min via Supabase MCP). Updates: Brighton 3,082 → 10,250, Edinburgh 2,140 → 5,478, etc. for all 16 venues. Replaces per-fixture with venue total.

2. **Action 2.A**: Open Cursor PR to fix spend rollup-sync filter (include paused campaigns). Re-fire force backfill. Should close 80% of spend discrepancies.

**This week:**

3. **Action 3.2 + 3.3**: Add Run Rate + CPT-at-sellout to Funnel Pacing UI. Single Cursor PR ~half day.

4. **Action 3.5**: Live Daily Budget portfolio column on client dashboard. Quick Cursor PR.

**Later (decisions needed):**

5. Decide on per-fixture vs per-venue funnel pacing scope (Category 4.3) — drives whether to invest in ad-set-level attribution (4.2).

6. Build Glasgow Combined feature once architecture decided.

---

## SUMMARY: 5 IMMEDIATE ACTIONS

| Priority | Action | Effort | Impact |
|---|---|---|---|
| **P0** | SQL update venue capacities (Action 1.A) | 5 min | Fixes 16 venues' dashboard capacity → sell-through % |
| **P0** | Fix rollup-sync to include paused campaigns (Action 2.A) | Cursor PR ~2h | Fixes 60-80% spend understatement portfolio-wide |
| **P1** | Add Run Rate to Funnel Pacing UI (Action 3.2) | Cursor PR ~half day | New strategic visibility |
| **P1** | Add CPT-at-sellout indicator (Action 3.3) | Cursor PR ~1h | Strategic visibility |
| **P2** | Live daily budget on client dashboard (Action 3.5) | Cursor PR ~2h | Portfolio-level operational view |

**After P0/P1 ship, Excel and dashboard should reconcile to within ~5% on every venue.**

---

## Verification queries after P0 fixes

```sql
-- Verify capacity update
SELECT event_code, MAX(capacity) AS venue_cap, COUNT(*) AS fixtures
FROM events WHERE event_code LIKE 'WC26-%'
GROUP BY event_code ORDER BY event_code;

-- Verify spend post-rollup-sync fix  
SELECT e.event_code, ROUND(SUM(edr.ad_spend_allocated + COALESCE(edr.ad_spend_presale, 0))::numeric, 2) AS dash_spent
FROM events e JOIN event_daily_rollups edr ON edr.event_id = e.id
WHERE e.event_code LIKE 'WC26-%' GROUP BY e.event_code ORDER BY e.event_code;
```

Cross-reference against Excel column Q (Spend) and column R (CPT) post-action.

---

## Cross-ref to today's PR backlog

| PR # | Status | Relevance to this audit |
|---|---|---|
| #481 | Merged | Allocator window cap — needed for spend accuracy |
| #482 | Merged | PUBLIC_PREFIXES carve-out — enables force-backfill |
| #483 | Merged | Allocator dedupe — performance fix for cron |
| #486 | Merged | MAX(event_date) — solves days-until issue (Action 2.3 ✓) |
| #487 | Merged | Funnel Pacing visual cleanup |
| #488 | Merged | Budget bar + Manchester audit |
| #489 | Merged | Ticket source convergence (MAX of 4tF + box office) |
| #490 | Merged | Share view exposure (Pacing + Performance vs Allocation) |
| TBD  | NEW | **Action 2.A** — rollup-sync paused-campaign filter (new) |
| TBD  | NEW | **Action 3.2** — Run Rate UI on Funnel Pacing (new) |
| TBD  | NEW | **Action 3.3** — CPT at sellout indicator (new) |
| TBD  | NEW | **Action 3.5** — Portfolio daily budget column (new) |
