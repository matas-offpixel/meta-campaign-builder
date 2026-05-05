# Session log: tier table channel cells and event rollup

## PR

- **Number:** `pending`
- **URL:** _populated after `gh pr create`_
- **Branch:** `fix/tier-table-channel-cells-and-event-rollup`

## Summary

Fixes the venue tier table display so channel data appears as one
sold/allocation cell per active channel instead of stacked allocation
and sold columns. Also replaces stale event-row ticket totals with
tier/channel-derived rollups so sold, capacity, sell-through, suggested
percent, and CPT are based on the same numbers as the tier table.

## Investigation findings

- The per-tier table lives in
  `components/dashboard/events/ticket-tiers-section.tsx`, with PR #284's
  channel UI coming from `ticket-tier-channel-breakdown.tsx`.
- The full venue report parent event row computes its Tickets cell in
  `components/share/venue-event-breakdown.tsx` via
  `event.latest_snapshot?.tickets_sold ?? event.tickets_sold`; this is
  the stale legacy path causing Brighton Croatia to show 580 instead of
  the tier/channel sum.
- The client portal expanded venue rows have the same legacy read in
  `components/share/client-portal-venue-table.tsx`, so this PR updates
  both surfaces.

## Scope / files

- `lib/dashboard/tier-channel-rollups.ts` — shared client-safe helpers
  for active channel detection, per-tier sold/allocation totals, and
  event rollups.
- `components/dashboard/events/ticket-tiers-section.tsx` — dynamic
  channel columns (`4TF`, `CP`, `SeeTickets`, etc.) with each cell
  rendered as `sold/allocation`; total sold/allocation and SOLD OUT
  treatment derive from the channel rollup.
- `components/dashboard/events/ticket-tier-channel-breakdown.tsx` —
  narrowed to the Edit cell/modal only; display columns moved into the
  tier table itself.
- `components/share/venue-event-breakdown.tsx` and
  `components/share/client-portal-venue-table.tsx` — event-row ticket
  totals/CPT now use tier/channel rollups instead of stale
  `events.tickets_sold`.

## Goals coverage

1. **Per-channel cells:** done; dynamic channel columns show
   `sold/allocation`.
2. **Total cell sums channels:** done; total = API/4TF tier sold plus
   manual channel sales over channel allocations when present.
3. **Visible channels from data:** done; headers come from allocation
   or sale rows present across the event's tiers.
4. **Event-row total:** done; event row uses `eventTierSalesRollup`.
5. **Derived sold %, suggested, CPT:** done; metrics use corrected
   sold/capacity.
6. **SOLD OUT logic:** done; per-tier sold-out uses corrected
   total sold >= total allocation.
7. **Edit popover unchanged:** preserved the existing manual-channel
   edit modal behavior, only moving display out of it.

## Validation

- [x] `npx tsc --noEmit`
- [x] Targeted `npx eslint` on modified files
- [x] IDE lints clean for modified files

## Notes

The helper intentionally uses `api_quantity_sold ?? quantity_sold` as
the automatic 4TF/API base so legacy `additional_ticket_entries` tier
overlays do not get double-counted when manual channel sales are added.
