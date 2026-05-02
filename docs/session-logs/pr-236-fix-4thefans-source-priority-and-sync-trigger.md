## PR

- **Number:** 236
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/236
- **Branch:** `fix/4thefans-source-priority-and-sync-trigger`

## Summary

Fixes the 4thefans sync path so a dashboard Sync now or post-link rollup sync also writes the current cumulative ticket snapshot with `source='fourthefans'`, allowing dashboard ticket totals to move past stale xlsx imports once the connector pulls fresh data.

## Scope / files

- `lib/dashboard/rollup-sync-runner.ts` now inserts `ticket_sales_snapshots` rows for current-count ticketing providers during the rollup sync path.
- `lib/ticketing/fourthefans/provider.ts` adds diagnostic logs around 4thefans event sales pulls and parsed ticket/revenue values.
- Production diagnostic query found Brighton Croatia currently has only xlsx snapshot rows and no 4thefans ticketing link rows for the client connection.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (not run; focused sync change covered by typecheck and tests)
- [x] `npm test`
- [x] `npx eslint "lib/dashboard/rollup-sync-runner.ts" "lib/ticketing/fourthefans/provider.ts"`

## Notes

`lib/db/event-history-collapse.ts` already resolves source priority as `manual > xlsx_import > fourthefans > eventbrite`; the missing piece was writing a fresh 4thefans snapshot on the sync trigger used by venue cards and bulk link.
