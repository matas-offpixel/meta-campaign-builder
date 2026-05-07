# Session log — fourthefans daily history backfill

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `feat/fourthefans-history-backfill`

## Summary

Adds GET `/events/{id}/sales?from=&to=` via `fetchFourthefansHistory`, merges multi-link daily deltas, converts to cumulative `ticket_sales_snapshots` rows (`source=fourthefans`, `snapshot_at` at noon UTC). Admin POST `/api/admin/event-history-backfill` verifies event ownership then uses service-role DB writes so `force` updates work (no RLS UPDATE on snapshots). Core logic lives in `event-history-backfill-core.ts` (node-testable); wrapper uses cookie client or injected service role.

## Scope / files

- `lib/ticketing/fourthefans/history.ts` — fetch + parse + merge + cumulative helpers
- `lib/db/event-history-backfill-core.ts` — injectable backfill execution
- `lib/db/event-history-backfill.ts` — server-only wrapper + default adapters
- `app/api/admin/event-history-backfill/route.ts`
- `lib/db/__tests__/event-history-backfill.test.ts`

## Validation

- [x] `npm test`
- [x] `eslint` on touched paths
- [x] `npm run build`

## Notes

- `history.ts` imports `./client.ts` so `node --test` resolves without `@/` alias (same pattern as relative imports in other unit tests).
