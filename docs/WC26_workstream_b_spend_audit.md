# Workstream B — Spend rollup-sync audit (WC26 reconciliation)

**Date:** 2026-05-29
**Author:** Cursor (overnight mega-PR `cursor/dashboard-wc26-reconciliation`)
**Verdict:** **No code change made. No production backfill fired.** The
premise behind Workstream B does not match the live code or the live
data. Details below.

---

## What Workstream B asked for

> Audit the rollup-sync Meta campaign filter. It's "likely only including
> ACTIVE campaigns"; expand it to include PAUSED/ARCHIVED, then fire
> `POST /api/admin/event-rollup-backfill?force=true`. Dashboard spend is
> "61% under-reported" (£24,664 vs Excel £62,595).

## Finding 1 — there is no ACTIVE-only campaign filter to remove

The rollup-sync Meta leg (`lib/dashboard/rollup-sync-runner.ts`) delegates
the campaign fetch to `fetchEventDailyMetaMetrics`
(`lib/insights/meta.ts:1963`). The only filter applied to the Meta
`/insights` call is:

```ts
const filtering = JSON.stringify([
  { field: "campaign.name", operator: "CONTAIN", value: filterPrefix },
]);
// level=campaign, time_increment=1, time_range=[since,until]
```

That is a **campaign-name** filter (`[<event_code>]` bracket), re-checked
case-sensitively client-side. There is **no `effective_status` / `status`
predicate** anywhere in the daily-metrics or lifetime-metrics fetch. The
Meta insights edge returns delivery for matching campaigns regardless of
ACTIVE/PAUSED state. **There is nothing to "remove" or "expand".**

## Finding 2 — the real spend column is `ad_spend_allocated`, and it has caught up

The dashboard reads `SUM(ad_spend_allocated) + SUM(ad_spend_presale)` (see
`venue-canonical-funnel.ts` `sumVenueSpend` / `computeSpendReconciliation`),
**not** raw `ad_spend`. Raw `ad_spend` is fanned-out per fixture (each
sibling row carries the full campaign spend), so summing it across a 3–4
fixture venue triple/quadruple-counts. The per-event allocator de-fans it
to the true venue total.

The audit doc's "Dashboard spend" column (Edinburgh £2,345, Brighton
£2,609, Aberdeen £640 …) was a **stale snapshot** taken while the
allocator cron was still mid-catch-up (the 800s timeout / Finding #3
referenced in the audit). Since PR #481 (window cap) and #483 (allocator
dedupe, ~14× fewer ops) merged, the cron has reached **100% event
coverage**. Live query on 2026-05-29:

| Venue | raw `ad_spend` (fanned) | **dashboard reads** (alloc + presale) | Excel Meta-direct | Δ vs Excel | alloc coverage |
|---|---|---|---|---|---|
| Edinburgh | 19,730 | **£7,025** | £7,024 | **+£1** ✓ | 3/3 |
| Brighton | 20,063 | **£6,696** | £6,694 | **+£2** ✓ | 4/4 |
| Kentish | 11,018 | **£3,672** | £3,697 | −£25 ✓ | 3/3 |
| Tottenham | 5,759 | **£1,440** | £1,465 | −£25 ✓ | 4/4 |
| Manchester | 29,623 | **£9,108** | £8,355 | +£753 | 4/4 |
| Glasgow O2 | 17,181 | **£6,357** | £5,130 | +£1,227 | 3/3 |
| Aberdeen | 5,691 | **£1,897** | £2,442 | −£545 | 3/3 |
| Birmingham | 9,984 | **£2,496** | £3,370 | −£874 | 4/4 |

The three P0 venues (Edinburgh, Brighton, Kentish) and Tottenham already
reconcile to Excel **within the audit's own ±£100 tolerance**. Firing the
force-backfill would not change these — the allocator has already run for
every event row.

## Finding 3 — the residual gaps are NOT a status-filter problem

The remaining non-trivial deltas have specific, different causes:

- **Glasgow O2 (+£1,227 over Excel):** the audit itself (§4.2) notes the
  Glasgow O2 `[WC26-GLASGOW-O2]` TRAFFIC campaign contains **mixed O2 +
  SWG3 ad sets**, and Excel does ad-set-level reallocation (74.5% O2 /
  25.5% SWG3). The dashboard attributes the whole campaign to its
  bracketed code. This is an **ad-set-level attribution** architecture
  decision (audit §4.2 option a/b), not a campaign-status filter.
- **Aberdeen / Birmingham (under Excel):** Excel's "Meta-direct" pull
  added campaigns that aren't bracket-matched by the dashboard's
  `[event_code]` naming convention (campaigns named without the bracket,
  or added/edited after the snapshot). This is a **campaign-naming
  hygiene** issue on the Meta side, not a code filter.

## Why no backfill was fired

1. The premise (status filter) is false — there is nothing to fix in code.
2. The P0 venues already match Excel; a backfill is a no-op for them.
3. `POST /api/admin/event-rollup-backfill?force=true` **rewrites
   `ad_spend_allocated` for every client**, not just 4theFans. Firing a
   broad, irreversible production write at 3am on a disproven premise
   directly contradicts the `feedback_no_fallback_papering_over_broken_source`
   guidance. The correct move is to leave the data as-is.

## Recommended follow-ups (separate, scoped work — not this PR)

1. **Ad-set-level attribution (audit §4.2):** the only way to make
   Glasgow O2/SWG3 match Excel exactly. ~2-day lift; needs a product
   decision (build it vs. enforce event-code-specific campaigns on Meta).
2. **Campaign-naming audit for Aberdeen/Birmingham:** confirm every live
   campaign carries the `[event_code]` bracket so the CONTAIN filter
   catches it.
3. **Refresh the audit doc's "Dashboard spend" column** — it is stale and
   overstates the divergence by ~3×.

## Reproduction query

```sql
SELECT e.event_code,
  ROUND(SUM(COALESCE(edr.ad_spend_allocated,0) + COALESCE(edr.ad_spend_presale,0))::numeric,2) AS dashboard_reads,
  COUNT(DISTINCT edr.event_id) FILTER (WHERE edr.ad_spend_allocated IS NOT NULL) AS events_with_alloc,
  COUNT(DISTINCT edr.event_id) AS events_total
FROM events e JOIN event_daily_rollups edr ON edr.event_id = e.id
WHERE e.event_code LIKE 'WC26-%'
GROUP BY e.event_code ORDER BY e.event_code;
```
