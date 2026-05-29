# Session log — Performance Summary capacity alignment

## PR

- **Number:** 492
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/492
- **Branch:** `cursor/performance-summary-capacity-alignment`

## Summary

Companion to PR #491 (WC26 reconciliation). Aligns `aggregateVenueCampaignPerformance`
(the function powering Performance Summary's venue-table via
`components/share/client-portal-venue-table.tsx`) to use
`aggregateSharedVenueCapacity()` — the same helper introduced in #491 for Funnel
Pacing. Before this fix, Performance Summary summed raw `events.capacity` per fixture,
showing ~13,538 for Manchester (SUM of 4 fixtures) while Funnel Pacing showed 8,200
(the strategic target). Also aligned `aggregateVenueGroupTotals` for consistency.

## Scope / files

| File | Change |
|------|--------|
| `lib/db/client-dashboard-aggregations.ts` | Replace inline `capacity += ev.capacity` SUM loops in `aggregateVenueCampaignPerformance` and `aggregateVenueGroupTotals` with `aggregateSharedVenueCapacity(events)` |
| `lib/db/__tests__/client-dashboard-aggregations.test.ts` | 7 new regression tests for Manchester (8,200), Edinburgh (5,478), Brighton (10,250), Glasgow O2 (6,750), and SUM-fallback parity |

## Validation

- `npx tsc --noEmit`: 0 new errors in production source
- `node --experimental-strip-types --test lib/db/__tests__/client-dashboard-aggregations.test.ts`: 83/83 pass (76 pre-existing + 7 new regression tests)
- No lint errors (`ReadLints`)

## Notes

- `aggregateSharedVenueCapacity()` returns `null` (not 0) when all capacities are null — same semantics as the previous `hasCapacity ? capacity : null` guard; callers unchanged.
- `aggregateVenueGroupTotals` is currently test-only (no component callers) but was aligned for consistency.
- No changes to the helper itself, migration, DB state, or Funnel Pacing logic.
