# Session log — Club Football allocator event_date scoping fix

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `thread/club-football-allocator-coverage`

## Summary

After PR #334 shipped singleton pass-through and non-WC26 equal-split, two
classes of event were still showing NULL `ad_spend_allocated`:

1. **Multi-fixture non-WC26 codes with distinct `event_date` values** —
   `4TF-TITLERUNIN-LONDON` has 3 fixtures each with a different `event_date`.
   The sibling query in `allocateVenueSpendForCode` previously scoped by
   `(client_id, event_code, event_date)`, so each fixture's allocator call saw
   only 1 sibling (itself), fell into `soloPassThroughAllocatedSpend`, and
   would have written the full campaign spend (£5,000) to each fixture —
   triple-counting. (Still NULL pre-backfill, but would have been wrong
   post-backfill.)

2. **True singletons** (Dublin, SF, Leeds FA Cup, Crystal Palace Final) —
   these ARE handled correctly by `soloPassThroughAllocatedSpend` but were
   still NULL because no backfill had been triggered since deploy.

Root cause: `event_date` was in the sibling grouping key for ALL codes.
`4TF26-ARSENAL-CL-FL` worked because both its fixtures have `event_date = NULL`
(imported without specific dates), so the `is("event_date", null)` path grouped
them together. `4TF-TITLERUNIN-LONDON` has populated event_dates → each run
saw itself alone.

Fix: WC26 codes keep `event_date` in the sibling key (opponent allocator
requires match-day isolation). Non-WC26 codes (`!isWc26OpponentAllocatorEventCode`)
drop `event_date` and group ALL fixtures with the same `event_code` together.
`equalSplitNonWc26AllocatedSpend` then reads the primary fixture's raw
`ad_spend` and divides by N — for TITLERUNIN's £5,000 across 3 fixtures each
gets £1,666.67. Singletons fall to `soloPassThroughAllocatedSpend` as before.

## Scope / files

- `lib/dashboard/venue-spend-allocator.ts` — sibling query now conditional on
  `isWc26OpponentAllocatorEventCode(eventCode)` for event_date scoping
- `lib/dashboard/__tests__/venue-spend-allocator-split.test.ts` — added
  TITLERUNIN 3-way split test + extended WC26 detection assertions

## Validation

- [x] `npm run lint` passes
- [x] 5 unit tests pass (node --experimental-strip-types)
- [ ] After backfill: TITLERUNIN fixtures each show ~£1,667; Dublin £219;
  Leeds FA Cup £1,517; Arsenal CL SF £400; Crystal Palace Final £595

## Notes

Backfill all affected event codes via `/api/admin/event-rollup-backfill` after
deploy. WC26 codes (Brighton, Newcastle, Tottenham, etc.) are unaffected — the
`isWc26OpponentAllocatorEventCode` guard keeps them on the existing
event_date-scoped path.
