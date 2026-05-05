## PR

- **Number:** 259
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/259
- **Branch:** `fix/4thefans-rollup-history-backfill`

## Summary

Adds a one-shot authenticated admin backfill route to reconstruct 4thefans historical daily ticket and revenue deltas from cumulative `ticket_sales_snapshots`.

## Scope / files

- Adds `POST /api/admin/fourthefans-rollup-backfill`
- Reconstructs deltas from `ticket_sales_snapshots.source = 'fourthefans'`
- Upserts only `tickets_sold`, `revenue`, and ticketing freshness on `event_daily_rollups`
- Skips dates that already have positive `tickets_sold` so post-PR #258 real deltas are not overwritten
- Adds pure reconstruction helper and regression tests

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "app/api/admin/fourthefans-rollup-backfill/route.ts" "lib/ticketing/fourthefans-rollup-backfill.ts" "lib/ticketing/__tests__/fourthefans-rollup-backfill.test.ts"`
- [x] `node --test lib/ticketing/__tests__/fourthefans-rollup-backfill.test.ts`

## Notes

The Brighton before/after screenshot requires running the authenticated preview route from a dashboard session. Suggested preview flow:

```bash
curl -X POST /api/admin/fourthefans-rollup-backfill \
  -H 'content-type: application/json' \
  --data '{"dry_run":true}'
```

Then run with `{"dry_run":false}` and verify a Central Park event's Daily Tracker running tickets totals 1,733 across reconstructed historical deltas.
