# Session log — 4TheFans per-attendee pull

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/4thefans-per-attendee-pull`

## Summary

Adds a parallel, additive daily-ticket-count source (`event_daily_ticket_history`)
that stores TRUE per-day attendee counts fetched directly from Eventbrite orders
and 4TheFans daily-delta APIs, eliminating the three classes of error identified
in audit PR #634 (intraday refunds, overnight-sale mis-attribution, sync-dropout
negative diffs). Nothing in `ticket_sales_snapshots`, `event_daily_rollups`, or
the existing canonical-tickets pipeline is modified.

## Scope / files

- `supabase/migrations/120_event_daily_ticket_history.sql` — new table with RLS,
  index on `(event_id, date DESC)`, unique constraint on `(event_id, date, source)`
- `lib/db/ticket-history.ts` — read helpers (`getDailyTicketHistoryForEvent`,
  `bestDailyTicketsForEvent`) + upsert helpers (`upsertDailyTicketHistory`,
  `upsertDailyTicketHistoryBatch`)
- `app/api/admin/ticket-history-backfill/route.ts` — POST endpoint; accepts
  `event_id` or `client_id` + optional `from`/`to` (default: 90 days);
  calls the two provider helpers and upserts results
- `app/api/cron/ticket-history-sync/route.ts` — cron GET; walks all active
  eventbrite + fourthefans connections, syncs last 7 days, idempotent upsert;
  budget guard + per-link retry on timeout
- `vercel.json` — adds `ticket-history-sync` cron at `30 6,12,18,22 * * *`
- `app/api/admin/ticket-history-compare/route.ts` — GET; produces side-by-side
  comparison of snapshot cumulative-diff vs true history for validation
- `lib/ticketing/__tests__/daily-ticket-history.test.ts` — 15 unit tests
  (3 suites: parseFourthefansSalesHistoryPayload, fetchDailyOrdersForEvent
  aggregation logic, bestDailyTickets pure logic)

## Verification plan (post-merge)

1. Apply migration 120 to remote (`supabase db push` or SQL console)
2. POST to `/api/admin/ticket-history-backfill` with
   `client_id = "37906506-56b7-4d58-ab62-1b042e2b561a"`,
   `from = "2026-06-15"`, `to = "2026-06-22"`
3. GET `/api/admin/ticket-history-compare?event_id=<BRIGHTON>&from=2026-06-15&to=2026-06-22`
   — verify `from_event_daily_ticket_history` matches client's internal tracker
4. Repeat for WC26-MANCHESTER and WC26-MARGATE fixtures

## Validation

- [x] 15/15 unit tests pass
- [x] No lint errors on new files
- [ ] `npx tsc --noEmit` (not run; server-only import guards unchanged)

## Notes

- `revenue_minor` stores pence/cents (major × 100). The Eventbrite helper
  already returns major units; upsert helpers multiply by 100 for storage.
- The `bestDailyTicketsForEvent` helper takes the MAX across sources per day.
  This is intentionally optimistic (picks the most complete reading).
- The cron filters Eventbrite results client-side to the last 7 days because
  the `fetchDailyOrdersForEvent` helper doesn't accept from/to. All rows
  are upserted idempotently so re-processing older dates is safe.
- `manual` and `foursomething_internal` providers are skipped by the cron
  (no history endpoint exists for them).
