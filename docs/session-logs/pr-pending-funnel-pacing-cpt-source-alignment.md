# Session log — funnel-pacing CPT / ticket source alignment

## PR

- **Number:** pending
- **URL:** (to be filled after `gh pr create`)
- **Branch:** `cursor/funnel-pacing-cpt-source-alignment`

## Summary

Third in the source-of-truth convergence series for the Funnel Pacing tab
(#475 Allocated, #476 Spent, this PR CPT/tickets). Fixes two remaining
divergences between Funnel Pacing and Performance Summary:

1. **Ticket source**: `ticketsSold` switched from `tier_channel_sales` SUM
   (3,498 for Edinburgh) to `events.tickets_sold` SUM (3,812). The 314-ticket
   gap is real; Performance Summary uses `events.tickets_sold`.

2. **Live CPT**: `computeSpendReconciliation` previously received `liveCpt`
   from the parent (allocated-only spend / tier_channel_sales tickets = £2.00).
   Now computed internally as `spent / ticketsSold` (allocated-only spend /
   events.tickets_sold = £1.83) — matches Performance Summary.

Also adds three new display fields to the Spend Reconciliation card:
- **Daily budget (Meta)** — live Meta active-ad-sets daily budget, read from
  the `getDailyBudgetUpdate` module cache (same source `VenuePaidMediaDailySpendTracker`
  populates on the Performance tab). Shows "—" / "Awaiting sync" when not yet
  fetched. `SpendReconciliationCard` is now a `"use client"` component for this.
- **Days remaining** — surfaces `backwardRead.daysToEvent` explicitly.
- **Overage amount** — warning banner now shows "additional budget needed by £X".

Additionally:
- `VenueSpendReconciliation` gains `liveCostPerTicket` and `warningAmount` fields.
- `MetricSource` gains `"events_table"` variant; `sources.purchases` updated.
- Cherry-picks #476's allocated-spend fix as a foundation (not yet merged to main).

## Scope / files

- `lib/dashboard/venue-canonical-funnel.ts` — `VenueSpendReconciliation`
  interface extended; `computeSpendReconciliation` removes `liveCpt` param,
  adds `ticketsSold`, computes `liveCostPerTicket` + `warningAmount` internally;
  `MetricSource` + `sources.purchases` updated
- `lib/dashboard/__tests__/venue-canonical-funnel.test.ts` — updated provenance
  test + new assertions for `liveCostPerTicket`, `warningAmount`
- `components/dashboard/clients/spend-reconciliation-card.tsx` — new `"use client"`
  component (extracted from funnel-pacing-venue-view.tsx); adds daily budget,
  days remaining, overage amount
- `components/dashboard/clients/funnel-pacing-venue-view.tsx` — remove inline
  `SpendReconciliationCard`; add `clientId` + `eventCode` props
- `components/dashboard/clients/funnel-pacing-section.tsx` — add `venueEventCode`
  prop; forward to `FunnelPacingVenueView`
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — `venueTicketsSold`
  from `e.tickets_sold`; pass `venueEventCode`
- `app/share/venue/[token]/page.tsx` — same

## Validation

- [x] All 22 tests pass (1 provenance test updated for `events_table` source)
- [x] `npm run build` — clean
- [x] `npx eslint` — 0 errors on touched files

## Edinburgh post-fix (2026-05-28)

| Field             | Before (PR-C) | After (this PR)      |
|-------------------|--------------|----------------------|
| Purchases bar     | 3,498         | **3,812** ✓ (= Performance Summary) |
| Live CPT          | £2.00         | **£1.83** ✓ (= Performance Summary) |
| Tickets remaining | 1,977         | 1,663                |
| Required/day      | £247          | **£190** ✓           |
| Required total    | £3,295        | £3,048               |
| Remaining         | £2,929        | £2,929 (unchanged)   |
| Warning           | additional_needed | additional_needed |
| Overage           | —             | **£118** (new field) |
| Daily budget      | —             | Live Meta (£70 when synced) |

## Notes

- `SpendReconciliationCard` is now a client component to read the live Meta
  daily budget from `getDailyBudgetUpdate`. Shows "Awaiting sync" until the
  Performance tab triggers a fetch on first load. No new API calls are made
  from this component.
- Cherry-picked #476's `computeSpendReconciliation` COALESCE fix as the first
  commit on this branch; when #476 merges to main, this branch's history will
  have a clean squash.
- Refs: #475, #476 (predecessors), #474 (source-of-truth contract), #467 (design).
