# Session log — asset queue retry and requeue

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/asset-queue-retry-requeue`

## Summary

Error rows in the asset queue only offered Skip, and skipped rows had no way back. Operators can Retry an error row (status restored from columns that already exist, then prepare re-runs when the row was matched) and Re-queue a skipped row back to pending with confirmed overrides cleared.

## Scope / files

- `lib/clients/asset-queue/queue-actions.ts` — pure retry/requeue decision (status code, next status, clear error, clear overrides, rerunPrepare)
- `app/api/clients/[id]/asset-queue/[queueId]/route.ts` — PATCH `retry` and `requeue`, same ownership checks as skip/launched/confirm; retry calls the existing prepare POST after the status update
- `components/dashboard/clients/asset-queue-panel.tsx` — Retry beside Skip on error rows; Re-queue on skipped rows (still collapsed); optimistic update with rollback
- `lib/clients/asset-queue/__tests__/queue-actions.test.ts`

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [ ] `npm test` (when applicable)

## Notes

No migration. `client_asset_queue` does not record the status a row had before it became `error`, and that history is recoverable from columns that already exist, so a new column is unnecessary.

Retry (`error` only, otherwise 409) clears `error_message` and restores status as follows:

- `resolved_event_codes_multi` has entries → `matched_umbrella` (prepare had an umbrella row) and the existing prepare POST runs again
- else `dropbox_url` is set and `error_message` is not `no_venue_mapping` → `matched` (prepare failed after a venue match) and prepare runs again
- else → `pending`, and prepare is not called

`no_venue_mapping` rows are inserted as `error` by scrape and were never matched, so a Dropbox URL on those rows does not mean `matched`. Prepare's own status gate and the prepare/launch handoff are unchanged. The sheet is not re-scraped.

Re-queue (`skipped` only, otherwise 409) sets status back to `pending` and `confirmed_overrides` to null. Nothing else is cleared, and prepare is not called.
