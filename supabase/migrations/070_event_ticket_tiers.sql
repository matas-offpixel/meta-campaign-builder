-- Migration 070 — latest ticket-tier breakdowns.
--
-- 4thefans event detail responses include ticket_tiers[] with per-tier
-- allocation and sold counts. The app only needs the latest breakdown for
-- reporting, so (event_id, tier_name) is unique and each sync replaces the
-- row with a fresh snapshot_at.

create table if not exists event_ticket_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  tier_name text not null,
  price numeric,
  quantity_sold integer not null default 0,
  quantity_available integer,
  snapshot_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, tier_name),
  unique (event_id, tier_name, snapshot_at)
);

comment on table event_ticket_tiers is
  'Latest per-event ticket-tier breakdown from the connected ticketing provider. Sync replaces rows by (event_id, tier_name); snapshot_at marks the provider fetch time.';

create index if not exists event_ticket_tiers_event_snapshot_idx
  on event_ticket_tiers (event_id, snapshot_at desc);

alter table event_ticket_tiers enable row level security;

-- No authenticated-user policies by design: reads/writes are performed only by
-- server-side service-role paths after event/share ownership has been checked.
