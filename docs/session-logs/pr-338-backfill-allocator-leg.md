# Session log — Add allocator leg to per-event backfill

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `thread/backfill-allocator-leg`

## Summary

The per-event `POST /api/admin/event-rollup-backfill` was writing `ad_spend`
via `runMetaBackfill` but never calling the venue-spend allocator, so
`ad_spend_allocated` remained NULL after every backfill. The allocator only
existed in `runRollupSyncForEvent` (used by the force-backfill `?force=true`
bulk path and the live cron). This is why PRs #334 and #335 fixed the
allocator logic but the columns stayed NULL — operators backfilled via the
per-event POST endpoint, which silently skipped the allocation step.

Fix: after `runMetaBackfill` succeeds, invoke `allocateVenueSpendForCode`
with the same parameters used by the live-sync path. Allocator failure is
soft — meta.ok stays true, ad_spend is valid, and the new `allocator` field
in the response surface the reason code for debugging.

Response now includes `allocator: { ok, rows_written, reason }` alongside the
existing `results.meta` field.

## Scope / files

- `app/api/admin/event-rollup-backfill/route.ts` — import
  `allocateVenueSpendForCode`; add allocator leg after meta backfill in POST
  handler; add `isAllocatorSoftSkip`; surface `allocator` in JSON response

## Validation

- [x] `npm run lint` passes
- [ ] POST backfill on Dublin → response includes `allocator.reason=solo_pass_through`,
  `allocator.rows_written>0`; DB shows `ad_spend_allocated = £221`
- [ ] POST backfill on TITLERUNIN fixture → `allocator.reason=equal_split_non_wc26`,
  3 siblings each get ~£1,667

## Notes

The `?force=true` bulk path (cron-authorized) uses `runRollupSyncForEvent`
which already included the allocator — no change needed there. This fix is
purely for the operator-facing per-event POST backfill.
