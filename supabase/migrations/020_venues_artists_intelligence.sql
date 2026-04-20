-- Migration 020 — Venues, Artists, and Intelligence layer scaffold.
--
-- Venues and Artists become first-class entities. Events get a nullable
-- venue_id FK that coexists with the existing flat text columns
-- (venue_name, venue_city, venue_country) — those stay as the display
-- fallback when no venue record is linked.
--
-- creative_tags lets the user annotate Meta ad IDs with structured tags
-- (format, hook, genre, style) so the heatmap can surface patterns.
--
-- audience_seeds stores named cross-event filter sets so a built audience
-- can be recalled and eventually exported to Meta as a Custom Audience.

-- ── Venues ────────────────────────────────────────────────────────────────

create table if not exists venues (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users (id) on delete cascade,
  name               text        not null,
  city               text        not null,
  country            text        not null default 'GB',
  capacity           integer,
  address            text,
  meta_page_id       text,
  meta_page_name     text,
  website            text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint venues_user_name_unique unique (user_id, name)
);

create index if not exists venues_user_id_idx on venues (user_id);

alter table venues enable row level security;
drop policy if exists venues_owner_select on venues;
create policy venues_owner_select on venues for select using (auth.uid() = user_id);
drop policy if exists venues_owner_insert on venues;
create policy venues_owner_insert on venues for insert with check (auth.uid() = user_id);
drop policy if exists venues_owner_update on venues;
create policy venues_owner_update on venues for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists venues_owner_delete on venues;
create policy venues_owner_delete on venues for delete using (auth.uid() = user_id);

create or replace function set_venues_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists venues_set_updated_at on venues;
create trigger venues_set_updated_at before update on venues for each row execute function set_venues_updated_at();

-- ── Artists ───────────────────────────────────────────────────────────────

create table if not exists artists (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users (id) on delete cascade,
  name               text        not null,
  genres             text[]      not null default '{}',
  meta_page_id       text,
  meta_page_name     text,
  instagram_handle   text,
  spotify_id         text,
  website            text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint artists_user_name_unique unique (user_id, name)
);

create index if not exists artists_user_id_idx on artists (user_id);

alter table artists enable row level security;
drop policy if exists artists_owner_select on artists;
create policy artists_owner_select on artists for select using (auth.uid() = user_id);
drop policy if exists artists_owner_insert on artists;
create policy artists_owner_insert on artists for insert with check (auth.uid() = user_id);
drop policy if exists artists_owner_update on artists;
create policy artists_owner_update on artists for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists artists_owner_delete on artists;
create policy artists_owner_delete on artists for delete using (auth.uid() = user_id);

create or replace function set_artists_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists artists_set_updated_at on artists;
create trigger artists_set_updated_at before update on artists for each row execute function set_artists_updated_at();

-- ── Event ↔ Artist junction ───────────────────────────────────────────────

create table if not exists event_artists (
  id             uuid        primary key default gen_random_uuid(),
  event_id       uuid        not null references events  (id) on delete cascade,
  artist_id      uuid        not null references artists (id) on delete cascade,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  is_headliner   boolean     not null default false,
  billing_order  integer     not null default 0,
  created_at     timestamptz not null default now(),
  constraint event_artists_unique unique (event_id, artist_id)
);

create index if not exists event_artists_event_id_idx  on event_artists (event_id);
create index if not exists event_artists_artist_id_idx on event_artists (artist_id);

alter table event_artists enable row level security;
drop policy if exists event_artists_owner_select on event_artists;
create policy event_artists_owner_select on event_artists for select using (auth.uid() = user_id);
drop policy if exists event_artists_owner_insert on event_artists;
create policy event_artists_owner_insert on event_artists for insert with check (auth.uid() = user_id);
drop policy if exists event_artists_owner_update on event_artists;
create policy event_artists_owner_update on event_artists for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists event_artists_owner_delete on event_artists;
create policy event_artists_owner_delete on event_artists for delete using (auth.uid() = user_id);

-- ── venue_id FK on events ─────────────────────────────────────────────────

alter table events
  add column if not exists venue_id uuid references venues (id) on delete set null;

create index if not exists events_venue_id_idx on events (venue_id);

comment on column events.venue_id is
  'Optional FK to a venues record. Null = only flat text columns (venue_name/city/country) are set. Both coexist during transition.';

-- ── Creative tags ─────────────────────────────────────────────────────────

create table if not exists creative_tags (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users (id) on delete cascade,
  event_id           uuid        references events (id) on delete cascade,
  meta_ad_id         text        not null,
  meta_creative_id   text,
  tag_type           text        not null check (tag_type in ('format','hook','genre','style','asset_type')),
  tag_value          text        not null,
  created_at         timestamptz not null default now(),
  constraint creative_tags_unique unique (user_id, meta_ad_id, tag_type, tag_value)
);

create index if not exists creative_tags_user_id_idx   on creative_tags (user_id);
create index if not exists creative_tags_event_id_idx  on creative_tags (event_id);
create index if not exists creative_tags_meta_ad_id_idx on creative_tags (meta_ad_id);

alter table creative_tags enable row level security;
drop policy if exists creative_tags_owner_select on creative_tags;
create policy creative_tags_owner_select on creative_tags for select using (auth.uid() = user_id);
drop policy if exists creative_tags_owner_insert on creative_tags;
create policy creative_tags_owner_insert on creative_tags for insert with check (auth.uid() = user_id);
drop policy if exists creative_tags_owner_delete on creative_tags;
create policy creative_tags_owner_delete on creative_tags for delete using (auth.uid() = user_id);

-- ── Audience seeds ────────────────────────────────────────────────────────

create table if not exists audience_seeds (
  id                        uuid        primary key default gen_random_uuid(),
  user_id                   uuid        not null references auth.users (id) on delete cascade,
  name                      text        not null,
  description               text,
  filters                   jsonb       not null default '{}',
  meta_custom_audience_id   text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists audience_seeds_user_id_idx on audience_seeds (user_id);

alter table audience_seeds enable row level security;
drop policy if exists audience_seeds_owner_select on audience_seeds;
create policy audience_seeds_owner_select on audience_seeds for select using (auth.uid() = user_id);
drop policy if exists audience_seeds_owner_insert on audience_seeds;
create policy audience_seeds_owner_insert on audience_seeds for insert with check (auth.uid() = user_id);
drop policy if exists audience_seeds_owner_update on audience_seeds;
create policy audience_seeds_owner_update on audience_seeds for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists audience_seeds_owner_delete on audience_seeds;
create policy audience_seeds_owner_delete on audience_seeds for delete using (auth.uid() = user_id);

create or replace function set_audience_seeds_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists audience_seeds_set_updated_at on audience_seeds;
create trigger audience_seeds_set_updated_at before update on audience_seeds for each row execute function set_audience_seeds_updated_at();

notify pgrst, 'reload schema';
