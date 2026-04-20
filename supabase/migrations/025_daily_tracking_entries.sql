-- Migration 025 — Per-event daily tracking entries.
--
-- Replaces the Excel "daily tracker" sheet the client team currently
-- updates by hand. One row per (event_id, date) holds the Meta-side
-- daily numbers (spend, link clicks) plus the client-reported daily
-- ticketing/revenue figures, with optional notes.
--
-- Surfacing on the public client portal:
--   - GET  /api/share/client/[token]/daily — read all entries for the
--     events under the share's client_id (no auth.uid() — the token is
--     the credential, route uses the service-role client + the same
--     resolveShareByToken pattern as /tickets).
--   - POST /api/share/client/[token]/daily — upsert one entry on
--     (event_id, date), gated by share.can_edit + cross-tenant guard.
--
-- Read path on the portal stays read-only for now (per design
-- decision); the POST exists so a future internal admin UI can
-- populate rows without a separate migration / route.

create table if not exists daily_tracking_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  date date not null,
  -- All numeric columns are nullable: a partial-day entry (e.g. spend
  -- recorded but tickets not yet reported by the venue) is a valid
  -- intermediate state and shouldn't be rejected.
  day_spend numeric,
  tickets integer,
  revenue numeric,
  link_clicks integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One canonical row per (event, calendar day). Re-saves overwrite.
  unique (event_id, date)
);

-- Read path uses the service-role client so RLS is mostly a defence-
-- in-depth measure for any future authenticated dashboard surface.
-- The shape mirrors every other per-user table in the schema: rows
-- are owned by their user_id, and only that user can manage them.
alter table daily_tracking_entries enable row level security;

drop policy if exists "users manage own tracking entries" on daily_tracking_entries;
create policy "users manage own tracking entries"
  on daily_tracking_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Lookups on the portal always filter by client_id and order by
-- (event_id, date). The unique (event_id, date) index already covers
-- per-event chronological reads; this complementary index makes the
-- "all entries for one client" load sub-millisecond at any scale.
create index if not exists daily_tracking_entries_client_id_date_idx
  on daily_tracking_entries (client_id, date);

-- Keep updated_at honest. Reuse the project-wide trigger function
-- if it exists (idempotent CREATE OR REPLACE in earlier migrations);
-- otherwise create a local one. Both call sites set updated_at to
-- now() so the trigger is a safety net for direct SQL edits.
create or replace function set_daily_tracking_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_tracking_entries_set_updated_at on daily_tracking_entries;
create trigger daily_tracking_entries_set_updated_at
  before update on daily_tracking_entries
  for each row
  execute function set_daily_tracking_entries_updated_at();

notify pgrst, 'reload schema';
