-- Migration 035 — Per-event activity panel cache.
--
-- Caches the three live signals the new event activity tab pulls in:
--   - google_news     : RSS-derived news items mentioning event /
--                       venue / client / artists
--   - spotify_releases: each linked artist's recent + upcoming releases
--   - weather         : Open-Meteo forecast (or climate fallback) at
--                       the venue lat/lng for the event date
--
-- TTLs are enforced in the route handler (news 6h, releases 24h,
-- weather 1h). Rows are upserted wholesale on each fetch — the
-- (event_id, source) unique constraint guarantees there's exactly
-- one cached payload per source per event.
--
-- RLS mirrors `events` ownership: the user_id column is FK to
-- auth.users and the policies are owner-only. The route handler
-- stamps user_id on every upsert so the cache is per-user even when
-- two users happen to track the same event.

create table if not exists event_activity_snapshots (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  event_id      uuid        not null references events (id) on delete cascade,
  source        text        not null check (source in ('google_news', 'spotify_releases', 'weather')),
  fetched_at    timestamptz not null default now(),
  payload_jsonb jsonb       not null,
  constraint event_activity_unique unique (event_id, source)
);

create index if not exists event_activity_snapshots_event_id_idx
  on event_activity_snapshots (event_id);
create index if not exists event_activity_snapshots_user_id_idx
  on event_activity_snapshots (user_id);

alter table event_activity_snapshots enable row level security;

drop policy if exists event_activity_owner_select on event_activity_snapshots;
create policy event_activity_owner_select on event_activity_snapshots
  for select using (auth.uid() = user_id);

drop policy if exists event_activity_owner_insert on event_activity_snapshots;
create policy event_activity_owner_insert on event_activity_snapshots
  for insert with check (auth.uid() = user_id);

drop policy if exists event_activity_owner_update on event_activity_snapshots;
create policy event_activity_owner_update on event_activity_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists event_activity_owner_delete on event_activity_snapshots;
create policy event_activity_owner_delete on event_activity_snapshots
  for delete using (auth.uid() = user_id);

comment on table event_activity_snapshots is
  'Per-event TTL cache for the activity panel: google_news (6h), spotify_releases (24h), weather (1h). Wholesale upsert per source.';

notify pgrst, 'reload schema';
