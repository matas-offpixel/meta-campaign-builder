## PR

- **Number:** 255
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/255
- **Branch:** `fix/4thefans-ticket-deltas`

## Summary

Changes current-snapshot ticketing providers such as 4thefans from writing lifetime tickets into today's daily rollup to writing the delta since the previous snapshot.

## Scope / files

- Adds a pure current-snapshot delta helper with regression tests
- Computes 4thefans/foursomething daily deltas against the latest snapshot before today, before inserting the new lifetime snapshot
- Keeps Eventbrite daily-order zero-padding unchanged
- Stops current-snapshot providers from zero-padding the 60-day ticket window
- Clears old pre-connector zero-padded ticket/revenue fields before the first provider snapshot date without blocking sync if cleanup fails

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "lib/dashboard/rollup-sync-runner.ts" "lib/db/ticketing.ts" "lib/db/event-daily-rollups.ts" "lib/ticketing/current-snapshot-delta.ts" "lib/ticketing/__tests__/current-snapshot-delta.test.ts"`
- [x] `node --test lib/ticketing/__tests__/current-snapshot-delta.test.ts lib/ticketing/__tests__/event-search.test.ts`
- [x] `node --test lib/ticketing/__tests__/current-snapshot-delta.test.ts`

## Notes

This PR intentionally does not solve revenue derivation. The current snapshot path still preserves whatever revenue the provider returns; Tier 2 will inspect the 4thefans payload and fix or derive revenue separately.
