# Session log — P0 dashboard Supabase timeouts

## PR

- **Number:** 639
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/639
- **Branch:** `cursor/p0-dashboard-supabase-timeouts`

## Summary

PRODUCTION DOWN P0 (2026-06-29 ~12:39–12:46 UTC): `/clients/{id}` (4theFans and
all clients) returned 504. Root cause was the client-portal loader's paginated
`ticket_sales_snapshots` read ordering by `snapshot_at` across an
`event_id = ANY(...)` filter — no index could serve that order, so every page
did a full Seq Scan of the 72MB / 29.5k-row table + Sort. Measured **37.5s** for
one deep page on the (compute-throttled) prod instance, far past the 8s
service-role `statement_timeout`; the resulting connection-pool pressure
surfaced as 300s `FUNCTION_INVOCATION_TIMEOUT`s. Two secondary issues:
`event_daily_rollups` reads were slowed by a 2-week-stale visibility map, and
**migration 042 (d2c credential encryption + `d2c_connections.live_enabled`) had
never been applied to prod** — every render logged `column
d2c_connections.live_enabled does not exist`.

Fix restored service **without a code deploy** via DB-only changes, plus a
durable code + migration follow-up:

1. `VACUUM (ANALYZE)` on `ticket_sales_snapshots` + `event_daily_rollups`
   (rollups deep page 2.6s → 331ms; refreshed visibility map for index-only scans).
2. New covering index `ticket_sales_snapshots_portal_covering_idx
   (event_id, snapshot_at, id) INCLUDE (tickets_sold, source)` → the portal read
   became a pure Index Only Scan, **37.5s → 78ms** (Heap Fetches: 0). It also
   serves the legacy `ORDER BY snapshot_at` shape via index-only scan + cheap
   in-memory sort (~289ms), so prod recovered immediately.
3. Applied the missing **migration 042** to prod (idempotent; added the 3 d2c
   columns + `set/get_d2c_credentials` RPCs + PostgREST schema reload).
4. Code: `fetchAllTicketSalesSnapshots` now orders by `(event_id, snapshot_at,
   id)` — sort-free index-only scan AND deterministic OFFSET pagination
   (`snapshot_at` alone is non-unique and could skip/duplicate rows across page
   boundaries).

## Scope / files

- `lib/db/client-portal-server.ts` — ticket-snapshot read ordering (the only
  app-code change). `app/(dashboard)/clients/[id]/page.tsx` intentionally NOT
  touched (owned by the in-flight `cursor/asset-queue-timeout-fix` PR; same-file
  / same-day tool boundary).
- `supabase/migrations/122_portal_timeout_covering_indexes.sql` — new covering
  index (idempotent, recorded in prod history).
- Prod DB (project `zbtldbfjbhfvpksmdvnt`): applied migration 042; created
  covering index; vacuumed both tables; dropped a redundant exploratory
  `snapshot_at`-leading index (planner preferred the (event_id, snapshot_at) one).

## Validation

- [x] `npx tsc --noEmit` — no errors in changed source (`client-portal-server.ts`);
  remaining output is pre-existing stale `.next` route types + a jest-types test file.
- [ ] `npm run build`
- [x] Prod `EXPLAIN (ANALYZE)` before/after: 37,500ms → 78ms (index-only, 0 heap fetches).
- [x] Prod verify: 3 d2c columns + 2 RPCs present; covering index present.

## Notes

- **Systemic risk (NOT fixed here — needs human):** the prod instance is
  **compute-throttled** — cached-buffer scans crawled at ~1MB/s and a bare MCP
  connection even timed out, consistent with burst-CPU-credit exhaustion from
  weekend matchday writes. The index makes queries cheap enough to live within
  that ceiling, but **recommend reviewing/raising the Supabase compute add-on**
  (or moving off burstable) so a future traffic/write spike doesn't re-trigger
  this. Autovacuum on `ticket_sales_snapshots` was also 2 weeks stale — consider
  a more aggressive per-table autovacuum scale factor given matchday write bursts.
- **Migration drift:** 042 (and possibly 043) silently missing from prod history
  is a process gap — worth an audit of local migration files vs prod
  `supabase_migrations.schema_migrations`.
- The covering index doubles as the target of the new code ordering; once
  deployed there is no in-memory sort at all on this read path.
- Follow-up consideration: the loader still fetches *all* ticket-snapshot history
  (29.5k rows) on every overview/events render. A future optimisation could fetch
  only what the aggregators need (latest + previous + collapsed series) rather
  than the full envelope.
