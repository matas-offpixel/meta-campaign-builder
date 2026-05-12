# Session log

## PR

- **Number:** 405
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/405
- **Branch:** `cursor/creator/bristol-event-breakdown-capacity-field`

## Summary

Fixes the Bristol Event Breakdown table showing "/20" as the capacity denominator for
all four WC26 fixtures (e.g. "236/20", "53/20") instead of the correct event-level
capacity (779–918). Root cause: `computeEventMetrics` was reading `tierTotals.allocation`
(sum of `quantity_available` across tiers, which was 20) before falling back to
`event.capacity`. Reversing the priority — prefer `events.capacity` (authoritative,
kept up to date by `updateEventCapacityFromTicketTiers`) over tier allocation — fixes
the denominator and automatically clears the false SOLD OUT badges caused by
`soldPct > 100%`.

## Scope / files

- `lib/dashboard/event-capacity-resolver.ts` — new pure module `resolveEventCapacity`
- `components/share/venue-event-breakdown.tsx` — uses resolver; removes inline comment
- `lib/dashboard/__tests__/venue-event-breakdown-table.test.ts` — 6 new tests

## Validation

- [x] `npm test` (venue-event-breakdown-table.test.ts) — 6/6 pass
- [ ] `npx tsc --noEmit`

## Notes

- `resolveEventCapacity(0, 500)` → 500: a `capacity=0` is treated as absent (not a
  real denominator) to handle events imported before the first sync runs.
- SOLD OUT badges clear automatically because `soldPct` is now well under 100% for
  Bristol events (236/779 ≈ 30%, not 1180%).
