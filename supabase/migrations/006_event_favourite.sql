-- 006_event_favourite.sql
--
-- Adds a per-event favourite flag for sticky pinning in dashboard
-- surfaces (event detail header toggle, future "favourites only"
-- filters on /events and /calendar).
--
-- Defaults to false so every existing row remains unfavourited
-- without backfill. Partial index keeps "favourites only" queries
-- cheap — only rows where favourite = true are indexed.

alter table public.events
  add column if not exists favourite boolean not null default false;

create index if not exists events_favourite_idx
  on public.events (user_id)
  where favourite;

-- Refresh PostgREST schema cache so the new column is exposed via the API.
notify pgrst, 'reload schema';
