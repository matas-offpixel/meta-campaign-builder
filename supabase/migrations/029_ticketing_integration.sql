-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 029 — Ticketing integration scaffolding.
--
-- v1 of the ticket-sales pipeline. Provider-agnostic by design so the same
-- rows back both the existing Eventbrite path (4TheFans uses it today) and
-- the upcoming 4TheFans-native API (their adapter ships behind a feature
-- flag in Task D).
--
-- Three tables:
--
--   client_ticketing_connections  — one row per (client, provider). Holds
--                                   the opaque credential blob (today: a
--                                   pasted Eventbrite personal token; later:
--                                   OAuth refresh + access tokens), the
--                                   external account id (Eventbrite
--                                   organization id, etc.), and basic
--                                   health (status, last_synced_at,
--                                   last_error). Unique on
--                                   (user_id, client_id, provider) so a
--                                   given client has at most one connection
--                                   per provider — re-saves overwrite.
--
--   event_ticketing_links         — pivots an internal `events.id` to an
--                                   external event id on the provider.
--                                   Unique on (event_id, connection_id) so
--                                   a single event can be linked to at
--                                   most one external event per
--                                   connection — but can carry multiple
--                                   links across providers (e.g. one
--                                   Eventbrite, one 4TheFans).
--
--   ticket_sales_snapshots        — append-only time-series. Each sync
--                                   writes one row. Sources: cron (every
--                                   6h, see Task E), manual /sync
--                                   endpoint, dashboard refresh button
--                                   (Task F). Indexed on
--                                   (event_id, snapshot_at desc) for the
--                                   pacing chart query.
--
-- Credentials: stored as `jsonb` so we can evolve the auth shape per
-- provider without a schema migration. v1 Eventbrite shape is
--   { "personal_token": "<eventbrite_oauth_token>" }
-- 4TheFans / future OAuth providers will likely use
--   { "access_token": "...", "refresh_token": "...", "expires_at": "..." }
--
-- After applying:
--   npx supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt \
--     > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

-- ── client_ticketing_connections ─────────────────────────────────────────

create table if not exists client_ticketing_connections (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users (id) on delete cascade,
  client_id            uuid        not null references clients (id)    on delete cascade,
  provider             text        not null
    check (provider in ('eventbrite', 'fourthefans')),
  credentials          jsonb       not null default '{}'::jsonb,
  external_account_id  text,
  status               text        not null default 'active'
    check (status in ('active', 'paused', 'error')),
  last_synced_at       timestamptz,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, client_id, provider)
);

comment on table  client_ticketing_connections is
  'One row per (client, provider) ticketing connection. Holds the opaque credential blob and per-connection health metadata. Provider-agnostic; the credential shape lives inside the jsonb so individual providers can evolve auth without schema changes.';
comment on column client_ticketing_connections.credentials is
  'Provider-specific auth blob. v1 Eventbrite shape: {personal_token}. Future OAuth providers store {access_token, refresh_token, expires_at, ...}.';
comment on column client_ticketing_connections.external_account_id is
  'Provider-side account identifier returned by validateCredentials (e.g. Eventbrite organization id). Used to bound listEvents queries.';

create index if not exists client_ticketing_connections_user_client_idx
  on client_ticketing_connections (user_id, client_id);

create index if not exists client_ticketing_connections_status_idx
  on client_ticketing_connections (status)
  where status = 'active';

-- ── event_ticketing_links ────────────────────────────────────────────────

create table if not exists event_ticketing_links (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,
  event_id            uuid        not null references events (id)     on delete cascade,
  connection_id       uuid        not null references client_ticketing_connections (id) on delete cascade,
  external_event_id   text        not null,
  external_event_url  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (event_id, connection_id)
);

comment on table  event_ticketing_links is
  'Pivots an internal events.id to an external event id on the provider. Unique on (event_id, connection_id) — one event maps to at most one external event per connection, but may carry multiple links across providers.';

create index if not exists event_ticketing_links_event_idx
  on event_ticketing_links (event_id);
create index if not exists event_ticketing_links_connection_idx
  on event_ticketing_links (connection_id);

-- ── ticket_sales_snapshots ───────────────────────────────────────────────

create table if not exists ticket_sales_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users (id) on delete cascade,
  event_id              uuid        not null references events (id)     on delete cascade,
  connection_id         uuid        not null references client_ticketing_connections (id) on delete cascade,
  snapshot_at           timestamptz not null default now(),
  tickets_sold          integer     not null default 0,
  tickets_available     integer,
  gross_revenue_cents   bigint,
  currency              text        default 'GBP',
  raw_payload           jsonb,
  created_at            timestamptz not null default now()
);

comment on table  ticket_sales_snapshots is
  'Append-only time-series of ticket sales pulled from the connected provider. One row per sync (cron, manual refresh, dashboard button). Pacing charts read the last N rows by snapshot_at desc.';
comment on column ticket_sales_snapshots.raw_payload is
  'Full provider response payload kept for debugging — never read by the app code. Drop policy: keep 90 days, then archive (not yet wired).';

create index if not exists ticket_sales_snapshots_event_snapshot_idx
  on ticket_sales_snapshots (event_id, snapshot_at desc);
create index if not exists ticket_sales_snapshots_connection_idx
  on ticket_sales_snapshots (connection_id, snapshot_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────

alter table client_ticketing_connections enable row level security;
alter table event_ticketing_links        enable row level security;
alter table ticket_sales_snapshots       enable row level security;

drop policy if exists ctc_owner_select on client_ticketing_connections;
create policy ctc_owner_select on client_ticketing_connections
  for select using (auth.uid() = user_id);
drop policy if exists ctc_owner_insert on client_ticketing_connections;
create policy ctc_owner_insert on client_ticketing_connections
  for insert with check (auth.uid() = user_id);
drop policy if exists ctc_owner_update on client_ticketing_connections;
create policy ctc_owner_update on client_ticketing_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists ctc_owner_delete on client_ticketing_connections;
create policy ctc_owner_delete on client_ticketing_connections
  for delete using (auth.uid() = user_id);

drop policy if exists etl_owner_select on event_ticketing_links;
create policy etl_owner_select on event_ticketing_links
  for select using (auth.uid() = user_id);
drop policy if exists etl_owner_insert on event_ticketing_links;
create policy etl_owner_insert on event_ticketing_links
  for insert with check (auth.uid() = user_id);
drop policy if exists etl_owner_update on event_ticketing_links;
create policy etl_owner_update on event_ticketing_links
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists etl_owner_delete on event_ticketing_links;
create policy etl_owner_delete on event_ticketing_links
  for delete using (auth.uid() = user_id);

drop policy if exists tss_owner_select on ticket_sales_snapshots;
create policy tss_owner_select on ticket_sales_snapshots
  for select using (auth.uid() = user_id);
drop policy if exists tss_owner_insert on ticket_sales_snapshots;
create policy tss_owner_insert on ticket_sales_snapshots
  for insert with check (auth.uid() = user_id);
drop policy if exists tss_owner_delete on ticket_sales_snapshots;
create policy tss_owner_delete on ticket_sales_snapshots
  for delete using (auth.uid() = user_id);
-- snapshots are append-only, so no update policy by design.

-- ── updated_at touch triggers ───────────────────────────────────────────

create or replace function set_client_ticketing_connections_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ctc_set_updated_at on client_ticketing_connections;
create trigger ctc_set_updated_at
  before update on client_ticketing_connections
  for each row execute function set_client_ticketing_connections_updated_at();

create or replace function set_event_ticketing_links_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists etl_set_updated_at on event_ticketing_links;
create trigger etl_set_updated_at
  before update on event_ticketing_links
  for each row execute function set_event_ticketing_links_updated_at();

notify pgrst, 'reload schema';
