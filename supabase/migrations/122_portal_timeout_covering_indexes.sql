-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 122 — Client-portal timeout remediation (P0, 2026-06-29)
--
-- Incident: /clients/{id} (4theFans + all clients) returning 504. Vercel logs
-- showed "canceling statement due to statement timeout" on the client-portal
-- loader's paginated ticket_sales_snapshots read, plus connection-pool
-- exhaustion bubbling up as 300s FUNCTION_INVOCATION_TIMEOUTs.
--
-- Root cause: `loadPortalForClientId` reads ticket_sales_snapshots with
-- `event_id = ANY(...)` ORDER BY snapshot_at and paginates via OFFSET. No index
-- could satisfy a global snapshot_at order across an event_id IN-list, so every
-- page did a full Seq Scan of the 72 MB table (29.5k rows, wide raw_payload
-- jsonb) + Sort. Measured 37.5s for a single deep page on the (compute-
-- throttled) prod instance — far past the 8s service-role statement_timeout.
--
-- Fix: a narrow COVERING index keyed (event_id, snapshot_at, id) INCLUDE
-- (tickets_sold, source) — exactly the four columns the loader selects plus a
-- unique paginating tie-break. The loader's read becomes a pure Index Only Scan
-- (Heap Fetches: 0 after VACUUM), measured 78ms even at OFFSET 5000. It serves
-- both the legacy `ORDER BY snapshot_at` shape (index-only scan + cheap in-mem
-- sort, ~289ms) and the new `ORDER BY (event_id, snapshot_at, id)` shape
-- (sort-free) shipped in lib/db/client-portal-server.ts alongside this.
--
-- Also run once manually on prod (NOT in this migration — VACUUM cannot run
-- inside a transaction): `VACUUM (ANALYZE) ticket_sales_snapshots;` and
-- `VACUUM (ANALYZE) event_daily_rollups;` — last autovacuum on the snapshots
-- table was 2 weeks stale after weekend matchday writes, leaving the visibility
-- map cold (740 heap fetches on the otherwise index-only scan).
--
-- NOTE: migration 042 (d2c credential encryption + d2c_connections.live_enabled)
-- was discovered MISSING from prod during this incident and applied separately.
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists ticket_sales_snapshots_portal_covering_idx
  on ticket_sales_snapshots (event_id, snapshot_at, id)
  include (tickets_sold, source);

comment on index ticket_sales_snapshots_portal_covering_idx is
  'Covering index for the client-portal loader read (lib/db/client-portal-server.ts fetchAllTicketSalesSnapshots). Enables an Index Only Scan over (event_id, snapshot_at) with a unique id tie-break; INCLUDE columns are the only non-key fields the loader selects. Added in P0 timeout remediation 2026-06-29.';

notify pgrst, 'reload schema';
