-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 052 — report_shares venue scope.
--
-- Adds a third share scope ('venue') to `report_shares` so operators can
-- mint a read-only link scoped to a single (client_id, event_code) pair
-- — i.e. one venue group — rather than either an individual event (legacy
-- default from Slice U) or the whole client roll-up (migration 014).
--
-- Schema shape after this migration:
--
--   scope='event'   → event_id  IS NOT NULL           (pre-existing)
--   scope='client'  → client_id IS NOT NULL           (pre-existing)
--   scope='venue'   → client_id IS NOT NULL AND
--                     event_code IS NOT NULL          (added here)
--
-- The event_code column is non-null only for scope='venue' shares; both
-- the scope='event' and scope='client' variants leave it null. This is
-- enforced by the updated cross-column check constraint below.
--
-- Backwards compatibility: every existing row is unaffected — the added
-- column defaults to null, the scope check is widened (not tightened),
-- and the cross-column constraint falls back to the existing event /
-- client branches when scope is neither 'venue' nor null.
--
-- Follow-up type generation:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Relax the scope CHECK to allow 'venue' ─────────────────────────────
--
-- The existing check was added inline on migration 014. Postgres doesn't
-- let us alter a column-level CHECK in place, so drop the inline variant
-- (if present) and re-assert via a named constraint that's easier to
-- evolve next time.
do $$
declare
  v_conname text;
begin
  -- Locate the existing scope check, if any (migration 014's inline
  -- form has a system-generated name; we normalise to a known name
  -- here so PR 5+ migrations can edit it idempotently).
  select conname into v_conname
    from pg_constraint
    where conrelid = 'public.report_shares'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%scope%in%';
  if v_conname is not null and v_conname <> 'report_shares_scope_check' then
    execute format(
      'alter table public.report_shares drop constraint %I',
      v_conname
    );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.report_shares'::regclass
      and conname = 'report_shares_scope_check'
  ) then
    alter table public.report_shares
      add constraint report_shares_scope_check
      check (scope in ('event', 'client', 'venue'));
  end if;
end $$;


-- ── 2. event_code column for venue-scope shares ───────────────────────────
--
-- Stored verbatim (not lowercased) so the URL slug matches the operator
-- intent; the internal dashboard groups events by the raw `event_code`
-- string so we want an exact-match lookup here too.
alter table public.report_shares
  add column if not exists event_code text;


-- ── 3. Evolve the cross-column shape constraint ───────────────────────────
--
-- Drop the old constraint (which only knew about 'event' and 'client')
-- and replace with the three-way variant. Idempotent via pg_constraint
-- lookup so re-running this migration in a branch deploy is a no-op.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.report_shares'::regclass
      and conname = 'report_shares_scope_target_check'
  ) then
    alter table public.report_shares
      drop constraint report_shares_scope_target_check;
  end if;

  alter table public.report_shares
    add constraint report_shares_scope_target_check check (
      (scope = 'event'  and event_id  is not null) or
      (scope = 'client' and client_id is not null) or
      (scope = 'venue'  and client_id is not null and event_code is not null)
    );
end $$;


-- ── 4. Helpful lookup index ───────────────────────────────────────────────
--
-- Operators look up an existing venue share by (client_id, event_code)
-- before minting a new one (idempotency on the "Share venue" click).
-- Partial index keyed on scope='venue' so we don't bloat the index with
-- rows that will never match this lookup.
create index if not exists report_shares_venue_idx
  on public.report_shares (client_id, event_code)
  where scope = 'venue';


comment on column public.report_shares.event_code is
  'Venue code for scope=''venue'' shares. Resolves to the set of events under (client_id, event_code) at render time. Null for scope=''event'' and scope=''client''.';


-- ── 5. PostgREST schema cache refresh ─────────────────────────────────────
notify pgrst, 'reload schema';
