-- ─────────────────────────────────────────────────────────────────────────────
-- Shared trigger function: keeps updated_at fresh on any row update.
-- Defined idempotently here so the migration is self-contained — the
-- function was defined in schema.sql but never actually applied to public,
-- so we recreate it here rather than depending on earlier state.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Clients
-- One row per booked agency client (promoter, venue, brand, artist, festival).
-- A client may span multiple roles (e.g. a venue that also promotes), so
-- primary_type + types[] are used instead of a single bucket.
-- Default Meta assets (ad account, pixel, pages) are denormalised onto the row
-- for phase 1. These may be normalised into related tables later if clients
-- need multiple ad accounts or pixels.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists clients (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                uuid        not null references auth.users (id) on delete cascade,
  name                   text        not null,
  slug                   text        not null,
  primary_type           text        not null,
  types                  text[]      not null default '{}',
  status                 text        not null default 'active',
  contact_name           text,
  contact_email          text,
  contact_whatsapp       text,
  default_ad_account_id  text,
  default_pixel_id       text,
  default_page_ids       text[]      not null default '{}',
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint clients_slug_unique_per_user unique (user_id, slug),
  constraint clients_primary_type_check check (
    primary_type in ('promoter', 'venue', 'brand', 'artist', 'festival')
  ),
  constraint clients_status_check check (
    status in ('active', 'paused', 'archived')
  )
);

create index if not exists clients_user_status_idx
  on clients (user_id, status);

alter table clients enable row level security;

create policy "Users can manage their own clients"
  on clients
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger clients_updated_at
  before update on clients
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Events
-- One row per live show. Always belongs to a client.
--
-- Date / time model:
--   event_date       date           — authoritative calendar date for the show
--   event_start_at   timestamptz    — optional, for when door/start time is known
--                                     (countdown logic, timezone-safe display,
--                                     calendar sync, day-of-show comms)
--
-- Operational milestones are timestamptz because time-of-day matters
-- (morning presales at 09:30, evening announcements at 17:00, etc).
--
-- genres is multi-value and may later expand into scene / subculture tags.
-- If genre taxonomy becomes load-bearing for reporting, promote to a lookup
-- table + join table.
--
-- Delete behaviour vs clients:
--   on delete restrict — deleting a client with events requires deliberate
--   cleanup. Protects against accidental loss of event + campaign history.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists events (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users (id) on delete cascade,
  client_id          uuid        not null references clients (id) on delete restrict,
  name               text        not null,
  slug               text        not null,
  event_code         text,
  capacity           integer,
  genres             text[]      not null default '{}',
  venue_name         text,
  venue_city         text,
  venue_country      text,
  event_timezone     text,
  event_date         date,
  event_start_at     timestamptz,
  announcement_at    timestamptz,
  presale_at         timestamptz,
  general_sale_at    timestamptz,
  ticket_url         text,
  signup_url         text,
  status             text        not null default 'upcoming',
  budget_marketing   numeric(12, 2),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint events_slug_unique_per_user unique (user_id, slug),
  constraint events_status_check check (
    status in ('upcoming', 'announced', 'on_sale', 'sold_out', 'completed', 'cancelled')
  )
);

create index if not exists events_user_client_idx
  on events (user_id, client_id);

create index if not exists events_user_event_date_idx
  on events (user_id, event_date);

alter table events enable row level security;

create policy "Users can manage their own events"
  on events
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger events_updated_at
  before update on events
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Link campaign_drafts to clients + events
-- Nullable so existing drafts are unaffected. on delete set null so historical
-- drafts survive parent deletion — campaign history is preserved even if the
-- client or event is later removed.
-- ─────────────────────────────────────────────────────────────────────────────

alter table campaign_drafts
  add column if not exists client_id uuid null
    references clients (id) on delete set null;

alter table campaign_drafts
  add column if not exists event_id uuid null
    references events (id) on delete set null;

create index if not exists campaign_drafts_client_idx
  on campaign_drafts (client_id);

create index if not exists campaign_drafts_event_idx
  on campaign_drafts (event_id);

-- Refresh PostgREST schema cache so new tables + columns are exposed to the API
notify pgrst, 'reload schema';
