-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 039 — event_daily_rollups
--
-- One row per (event, calendar day) holding a snapshot of the day's
-- ad spend + link clicks (from Meta) and tickets sold + revenue (from
-- Eventbrite, with room for other ticketing providers later). Backs
-- the new <DailyTracker /> table on the event detail Overview tab,
-- which mirrors Matas's manual xlsx tracker.
--
-- Why a new table instead of reusing existing ones?
--   - `daily_tracking_entries` (migration 025) is operator-entered;
--     this table is auto-populated from the Meta + Eventbrite APIs.
--     Conflating them would lose the "is this a manual entry or a
--     synced number?" distinction that the table needs to render
--     "last synced" correctly per source.
--   - `ticket_sales_snapshots` (migration 029) is append-only and
--     keyed by `snapshot_at` (timestamptz). A daily rollup keyed by
--     `(event_id, date)` is a different shape — one canonical row
--     per day that the sync route upserts.
--
-- Per-source freshness:
--   We track `source_meta_at` and `source_eventbrite_at` separately
--   so the auto-sync-on-mount logic in the UI can compute staleness
--   per data source. A row that has had its Eventbrite half refreshed
--   in the last minute but Meta hasn't been touched in two hours is
--   correctly classed as "needs Meta re-sync".
--
-- RLS:
--   Per-user via events.user_id. Mirrors the pattern in 029 — all
--   policies are SECURITY INVOKER so the encrypted-creds RPCs from
--   038 still apply when the sync route fans out reads.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists event_daily_rollups (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users (id) on delete cascade,
  event_id              uuid        not null references events (id)     on delete cascade,
  date                  date        not null,
  -- Meta side. Nullable because the event may have no campaigns yet
  -- but still have ticket sales (free events, or warm-up periods).
  ad_spend              numeric(12, 2),
  link_clicks           integer,
  -- Ticketing side. Same nullability story for the inverse case
  -- (campaign live before Eventbrite link is wired).
  tickets_sold          integer,
  revenue               numeric(12, 2),
  -- Per-source freshness so the UI can refresh whichever half is
  -- stale without trusting a single combined timestamp.
  source_meta_at        timestamptz,
  source_eventbrite_at  timestamptz,
  -- Operator notes column — click-to-edit on the row, persisted via
  -- the PATCH route. Distinct from `events.notes` (which is the
  -- event-level long-form note); these are short per-day annotations
  -- ("press hit", "lineup drop", etc.).
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- One canonical row per (event, calendar day). The sync route
  -- upserts on conflict; PATCHes to notes touch this same row.
  constraint event_daily_rollups_event_date_unique unique (event_id, date)
);

-- Hot-path index for the UI: load every rollup row for a given event,
-- date desc. The unique constraint above already covers (event_id,
-- date), but date-desc lookups benefit from a dedicated B-tree.
create index if not exists event_daily_rollups_event_date_idx
  on event_daily_rollups (event_id, date desc);

-- ── RLS ──────────────────────────────────────────────────────────────────

alter table event_daily_rollups enable row level security;

drop policy if exists edr_owner_select on event_daily_rollups;
create policy edr_owner_select on event_daily_rollups
  for select using (auth.uid() = user_id);

drop policy if exists edr_owner_insert on event_daily_rollups;
create policy edr_owner_insert on event_daily_rollups
  for insert with check (auth.uid() = user_id);

drop policy if exists edr_owner_update on event_daily_rollups;
create policy edr_owner_update on event_daily_rollups
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists edr_owner_delete on event_daily_rollups;
create policy edr_owner_delete on event_daily_rollups
  for delete using (auth.uid() = user_id);

-- ── updated_at touch trigger ────────────────────────────────────────────

create or replace function set_event_daily_rollups_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_event_daily_rollups_updated_at
  on event_daily_rollups;
create trigger trg_event_daily_rollups_updated_at
  before update on event_daily_rollups
  for each row execute function set_event_daily_rollups_updated_at();

notify pgrst, 'reload schema';
