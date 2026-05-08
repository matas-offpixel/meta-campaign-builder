# Session log — fix(ticketing): service-role upsert for event_ticket_tiers + surface RLS failures

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/event-ticket-tiers-service-role-upsert`

## Summary

PR #348 fixed the parser so tier rows are correctly emitted for all links, but
all four upserts still fail silently with "new row violates row-level security
policy for table event_ticket_tiers" — logged as `console.warn` and `return 0`,
so the route returned `ok:true, eventsSynced:1` with zero tier rows written.

Fix: `replaceEventTicketTiers` (lib/db/ticketing.ts) now creates its own
service-role client internally for the write path (same pattern as PR #347's
history-backfill route). Ownership of `event_id` is always verified by the
calling route before reaching here, so service-role write is safe. Falls back
to the passed-in session client when `SUPABASE_SERVICE_ROLE_KEY` is not
configured (local dev), with a clear warning.

The upsert failure path is promoted from `console.warn + return 0` to
`throw new Error(...)` so callers can no longer silently absorb the failure.
In `rollup-sync-runner.ts` the tier write is wrapped in its own try/catch
(isolated from the daily-rollup upsert that follows), with the error captured
into `firstError`; the rollup leg result surfaces it via `eventbriteResult.error`
while still attempting to write the daily rollup rows. In
`app/api/ticketing/sync/route.ts` a similar guard converts the throw into a
structured `tierWriteError` field on the response and flips `ok=false`, making
the 207 status code meaningful.

## Scope / files

- `lib/db/ticketing.ts` — add `createServiceRoleClient` import; create
  service-role write client in `replaceEventTicketTiers`; promote upsert
  failure from warn+return to throw
- `lib/dashboard/rollup-sync-runner.ts` — wrap tier write block in isolated
  try/catch; errors flow into `firstError` without aborting the rollup upsert
- `app/api/ticketing/sync/route.ts` — guard tier write; surface
  `tierWriteError` in response; flip `allOk` to false on tier write failure

## Validation

- [x] `npm run lint` — no new errors in changed files
- [x] `npm run build` — clean
- [x] `npm test` — 774 tests, 0 failures (channel safety suite still passes)

## Notes

- The `replaceEventTicketTiers` function signature is unchanged; no call site
  needs updating. The service-role client is acquired internally.
- After merge, run the DevTools console snippet to repopulate the four events.
- For the "forced RLS failure" double-check: revoking the service-role key
  (`SUPABASE_SERVICE_ROLE_KEY=""`) causes a warn + fallback to session client,
  which gets the RLS rejection as a thrown error, which becomes
  `eventbriteResult.error` in the response with `ok:false`.
