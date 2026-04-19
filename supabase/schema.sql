-- ─────────────────────────────────────────────────────────────────────────────
-- Campaign Drafts
-- Stores full wizard state as JSON. One row per campaign draft per user.
-- Status field is top-level for fast filtering in the library view.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists campaign_drafts (
  id             uuid        primary key,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  name           text,
  objective      text,
  status         text        not null default 'draft',
  ad_account_id  text,
  draft_json     jsonb       not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table campaign_drafts enable row level security;

create policy "Users can manage their own drafts"
  on campaign_drafts
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger campaign_drafts_updated_at
  before update on campaign_drafts
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Campaign Templates
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists campaign_templates (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  description   text        not null default '',
  tags          text[]      not null default '{}',
  snapshot_json jsonb       not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table campaign_templates enable row level security;

create policy "Users can manage their own templates"
  on campaign_templates
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger campaign_templates_updated_at
  before update on campaign_templates
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Facebook provider token (per user, for Meta Graph with user's Facebook session)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists user_facebook_tokens (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  provider_token  text not null,
  updated_at      timestamptz not null default now(),
  -- NULL until next reconnect; populated by /auth/facebook-callback
  expires_at      timestamptz
);

alter table user_facebook_tokens enable row level security;

create policy "Users read own facebook token"
  on user_facebook_tokens
  for select
  using (auth.uid() = user_id);

create policy "Users upsert own facebook token"
  on user_facebook_tokens
  for insert
  with check (auth.uid() = user_id);

create policy "Users update own facebook token"
  on user_facebook_tokens
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own facebook token"
  on user_facebook_tokens
  for delete
  using (auth.uid() = user_id);

create trigger user_facebook_tokens_updated_at
  before update on user_facebook_tokens
  for each row execute procedure update_updated_at_column();


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
  favourite          boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint events_slug_unique_per_user unique (user_id, slug),
  constraint events_status_check check (
    status in ('upcoming', 'announced', 'on_sale', 'sold_out', 'completed', 'cancelled')
  )
);

create index if not exists events_user_client_idx
  on events (user_id, client_id);

-- Partial — only indexes rows where favourite = true. Cheap "favourites
-- only" lookups for dashboard surfaces.
create index if not exists events_favourite_idx
  on events (user_id)
  where favourite;

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


-- ─────────────────────────────────────────────────────────────────────────────
-- Migration helper: add columns to existing campaign_drafts if upgrading
-- Run these if the table already exists without the new columns.
-- ─────────────────────────────────────────────────────────────────────────────
-- alter table campaign_drafts add column if not exists status text not null default 'draft';
-- alter table campaign_drafts add column if not exists ad_account_id text;

-- ─────────────────────────────────────────────────────────────────────────────
-- campaign-assets Storage Bucket
-- Used for video uploads: client uploads directly to Supabase Storage,
-- server fetches + streams to Meta, then removes the object.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-assets',
  'campaign-assets',
  false,
  209715200,  -- 200 MB
  array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- RLS: authenticated users can upload and read their own files
create policy "Authenticated users can upload campaign assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'campaign-assets');

create policy "Authenticated users can read campaign assets"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'campaign-assets');

create policy "Authenticated users can delete their campaign assets"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'campaign-assets');
