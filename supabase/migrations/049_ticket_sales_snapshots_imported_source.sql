-- ============================================================================
-- 049_ticket_sales_snapshots_imported_source.sql
-- ============================================================================
--
-- Relaxes ticket_sales_snapshots to accept rows with NO ticketing connection
-- (xlsx import, manual entry) and introduces a `source` discriminator so the
-- app can reason about provenance without plumbing through connection joins.
--
-- Context: pre-049 the table was Eventbrite-centric — `connection_id NOT NULL`
-- assumed every snapshot came from a provider sync. The overnight bundle
-- (PR 2) adds weekly xlsx imports (historical catch-up) and PR 3 adds a
-- "manual" provider where the operator keys cumulative numbers directly.
-- Both need to write snapshot rows without a `client_ticketing_connections`
-- row tying them to upstream credentials.
--
-- Skipping migration 047 — it was never created (slot reserved during
-- planning but abandoned). The forward-only migration chain tolerates the
-- gap because Supabase migrations identify by filename, not number.
--
-- After this ships:
--   * cron-Eventbrite writes carry source='eventbrite' (back-filled below
--     so existing rows participate in the new check constraint).
--   * xlsx imports write source='xlsx_import' with connection_id=NULL.
--   * PR 3's manual entry writes source='manual' with connection_id=NULL.
--   * A future 4theFans API provider writes source='foursomething'.
-- ============================================================================

alter table ticket_sales_snapshots
  alter column connection_id drop not null;

alter table ticket_sales_snapshots
  add column if not exists source text;

-- Back-fill existing rows. Every pre-049 row was written by the Eventbrite
-- provider, so tagging them as 'eventbrite' is safe. Run BEFORE the
-- NOT NULL constraint so no row is left unlabelled.
update ticket_sales_snapshots
set source = 'eventbrite'
where source is null;

alter table ticket_sales_snapshots
  alter column source set not null,
  alter column source set default 'eventbrite';

-- Drop-if-exists guards against re-running the migration on a branch that
-- already landed an earlier version of the constraint with the same name.
alter table ticket_sales_snapshots
  drop constraint if exists ticket_sales_snapshots_source_check;

alter table ticket_sales_snapshots
  add constraint ticket_sales_snapshots_source_check
  check (source in ('eventbrite', 'manual', 'xlsx_import', 'foursomething'));

-- Idempotency gate for the xlsx-import path. The importer upserts on
-- (event_id, snapshot_at, source) so re-running with the same xlsx is a
-- no-op rather than duplicating every weekly row. No-op for pre-049 data
-- (single-source rows) — the composite just replaces the de-facto
-- (event_id, snapshot_at) uniqueness the cron job implicitly relied on.
create unique index if not exists
  ticket_sales_snapshots_event_snapshot_source_idx
  on ticket_sales_snapshots (event_id, snapshot_at, source);

comment on column ticket_sales_snapshots.source is
  'Provenance of this snapshot row. eventbrite = cron/manual refresh from the Eventbrite API (default, every pre-049 row back-filled to this). manual = operator-entered cumulative tickets for events with no API provider. xlsx_import = weekly catch-up from an operator upload. foursomething = 4theFans internal API once wired up. NEVER mutated after insert.';

notify pgrst, 'reload schema';
