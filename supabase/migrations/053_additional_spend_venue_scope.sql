-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 053 — additional_spend_entries venue scope.
--
-- Extends `additional_spend_entries` (migration 044) from per-event-only to
-- also support venue-scope rows. Per-event rows stay untouched; venue rows
-- FK into an event for RLS/ownership but roll up at venue (event_code) level
-- on the reporting surface.
--
-- Shape after this migration:
--
--   scope='event' (default) → event_id NOT NULL, venue_event_code NULL
--                            (pre-existing rows back-filled via default)
--   scope='venue'           → event_id NOT NULL (used for ownership),
--                            venue_event_code NOT NULL (pivot column)
--
-- We keep `event_id` NOT NULL on venue rows because:
--   1. RLS already predicates on `user_id` which resolves through the
--      event chain today — rather than rewriting RLS we keep the event
--      pointer so policies stay unchanged.
--   2. Venue rows are semantically tied to a venue group under a client;
--      pointing at "any event in the group" is sufficient for ownership
--      (the reporting layer aggregates by `venue_event_code`, not by
--      `event_id`, for venue scope).
--
-- Aggregation semantics (reporting layer, not SQL):
--   - Per-event totals include only rows where `scope='event' AND event_id = :id`.
--   - Per-venue totals include:
--       * scope='event' rows across every event in the venue group, PLUS
--       * scope='venue' rows keyed on `venue_event_code = :event_code`.
--   - Client-wide totals include all rows under any event in the client.
--
-- Backwards compat:
--   - Existing event-scope rows are unaffected; the default is `'event'`.
--   - The table's existing RLS policies continue to work unchanged —
--     venue rows predicate on `user_id` via the same owner column.
--
-- Follow-up type generation:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. scope column + CHECK ────────────────────────────────────────────────
--
-- Default ensures every existing row (all pre-054 data) lands on
-- `'event'`, matching current UI semantics.
alter table public.additional_spend_entries
  add column if not exists scope text not null default 'event';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.additional_spend_entries'::regclass
      and conname = 'additional_spend_entries_scope_check'
  ) then
    alter table public.additional_spend_entries
      add constraint additional_spend_entries_scope_check
      check (scope in ('event', 'venue'));
  end if;
end $$;


-- ── 2. venue_event_code column ─────────────────────────────────────────────
--
-- Nullable column, populated only on scope='venue' rows. The cross-
-- column check below enforces the pairing — a scope='venue' row
-- without a venue_event_code (or vice versa) is rejected.
alter table public.additional_spend_entries
  add column if not exists venue_event_code text;


-- ── 3. Cross-column shape constraint ───────────────────────────────────────
--
-- event-scope rows MUST leave venue_event_code null (so aggregations
-- can safely distinguish scope by column presence).
-- venue-scope rows MUST provide a non-empty venue_event_code.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.additional_spend_entries'::regclass
      and conname = 'additional_spend_entries_scope_shape_check'
  ) then
    alter table public.additional_spend_entries
      drop constraint additional_spend_entries_scope_shape_check;
  end if;

  alter table public.additional_spend_entries
    add constraint additional_spend_entries_scope_shape_check check (
      (scope = 'event' and venue_event_code is null) or
      (scope = 'venue' and venue_event_code is not null
                        and char_length(venue_event_code) between 1 and 128)
    );
end $$;


-- ── 4. Index for venue-scope lookups ───────────────────────────────────────
--
-- The reporting layer fetches venue rows via `(venue_event_code)` with
-- an implicit client scope (joined through events.client_id). Partial
-- index keeps it tight.
create index if not exists additional_spend_entries_venue_idx
  on public.additional_spend_entries (venue_event_code)
  where scope = 'venue';


-- ── 5. Column comments for the schema browser ──────────────────────────────
comment on column public.additional_spend_entries.scope is
  'Discriminator: ''event'' (default) ties the row to a single event_id; ''venue'' pivots the row on venue_event_code across all events sharing that code under the client.';

comment on column public.additional_spend_entries.venue_event_code is
  'Non-null only when scope=''venue''. Aggregates roll up by (client_id, venue_event_code) via the associated event row.';


-- ── 6. PostgREST schema cache refresh ──────────────────────────────────────
notify pgrst, 'reload schema';
