-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014 — client report shares + weekly snapshots.
--
-- Two pieces of infrastructure for the upcoming client-portal slice:
--
-- 1. Extend report_shares (Slice U) with three columns to support
--    client-wide shares + edit grants:
--      - can_edit  boolean — does the token grant edit ops, not just read?
--      - scope     text    — 'event' (legacy default) or 'client' (new)
--      - client_id uuid    — populated only when scope='client'; FK clients
--    To support scope='client' shares (which pivot on a client rather
--    than a single event) the existing event_id column is also dropped
--    from NOT NULL and a check constraint enforces:
--        scope='event'  → event_id IS NOT NULL
--        scope='client' → client_id IS NOT NULL
--    Existing rows are unaffected: scope defaults to 'event',
--    can_edit defaults to false, client_id stays null. RLS is
--    unchanged — owners still manage their own shares; public reads
--    still bypass RLS through the service-role client.
--
-- 2. New table client_report_weekly_snapshots — one row per
--    (event_id, week_start) capturing tickets sold + revenue at a
--    point in time, attributed via captured_by ('client', 'internal',
--    or a token id). Powers the week-over-week deltas in the client
--    portal. user_id is denormalised (matches the report_shares /
--    ad_plan_days pattern) so RLS doesn't have to traverse a join.
--
-- After applying:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Extend report_shares ────────────────────────────────────────────────

alter table report_shares
  add column if not exists can_edit  boolean not null default false,
  add column if not exists scope     text    not null default 'event'
    check (scope in ('event', 'client')),
  add column if not exists client_id uuid    references clients (id) on delete cascade;

-- event_id was NOT NULL — relax so a scope='client' share can omit it.
alter table report_shares
  alter column event_id drop not null;

-- Cross-column shape check. Idempotent via pg_constraint lookup.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'report_shares_scope_target_check'
  ) then
    alter table report_shares
      add constraint report_shares_scope_target_check check (
        (scope = 'event'  and event_id  is not null) or
        (scope = 'client' and client_id is not null)
      );
  end if;
end $$;

create index if not exists report_shares_client_id_idx on report_shares (client_id);

comment on column report_shares.can_edit  is
  'When true the share token grants edit operations (e.g. tickets-sold capture from the client portal); false = read-only. Defaults to false.';
comment on column report_shares.scope     is
  '''event'' = single-event report (legacy default, requires event_id). ''client'' = client-wide rollup (requires client_id, event_id may be null).';
comment on column report_shares.client_id is
  'FK to clients. Populated only when scope=''client''. Null for scope=''event''.';


-- ── 2. New table: client_report_weekly_snapshots ───────────────────────────

create table if not exists client_report_weekly_snapshots (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references auth.users (id) on delete cascade,
  client_id                uuid        not null references clients     (id) on delete cascade,
  event_id                 uuid        not null references events      (id) on delete cascade,
  week_start               date        not null,
  tickets_sold             integer,
  tickets_sold_previous    integer,
  revenue                  numeric(12, 2),
  captured_at              timestamptz not null default now(),
  captured_by              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint client_report_weekly_snapshots_event_week_unique
    unique (event_id, week_start)
);

create index if not exists client_report_weekly_snapshots_client_idx
  on client_report_weekly_snapshots (client_id, week_start desc);

create index if not exists client_report_weekly_snapshots_event_idx
  on client_report_weekly_snapshots (event_id, week_start desc);

alter table client_report_weekly_snapshots enable row level security;

-- Owner full access. Public reads via the share-token path go through
-- the service-role client (bypassing RLS), same pattern as report_shares.
create policy "owner read"
  on client_report_weekly_snapshots for select
  using (auth.uid() = user_id);

create policy "owner insert"
  on client_report_weekly_snapshots for insert
  with check (auth.uid() = user_id);

create policy "owner update"
  on client_report_weekly_snapshots for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owner delete"
  on client_report_weekly_snapshots for delete
  using (auth.uid() = user_id);

-- update_updated_at_column() is defined in migration 003.
drop trigger if exists client_report_weekly_snapshots_updated_at
  on client_report_weekly_snapshots;
create trigger client_report_weekly_snapshots_updated_at
  before update on client_report_weekly_snapshots
  for each row execute procedure update_updated_at_column();

comment on table  client_report_weekly_snapshots is
  'One row per (event_id, week_start) capturing tickets sold + revenue at a point in time. Powers week-over-week deltas in the client-facing report.';
comment on column client_report_weekly_snapshots.week_start  is
  'Monday of the captured week (date, not timestamptz).';
comment on column client_report_weekly_snapshots.tickets_sold_previous is
  'Tickets sold as of the previous capture for this event — denormalised so the portal can render a delta without a self-join.';
comment on column client_report_weekly_snapshots.captured_by is
  '''client'' = self-reported via portal, ''internal'' = team capture, or a token id when minted via a share link.';


-- ── 3. PostgREST schema cache refresh ─────────────────────────────────────

notify pgrst, 'reload schema';
