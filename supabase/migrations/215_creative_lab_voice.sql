-- Creative Lab voice. A page's own captions. Traits are computed from these
-- rows at write time; there is no traits table.
-- Written, not applied. Matas applies. No DDL from the branch.

create table voice_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page_kind text not null check (page_kind in ('promoter', 'artist')),
  client_id uuid not null references clients (id) on delete cascade,
  artist_id uuid references creative_lab_artists (id) on delete cascade,
  ig_media_id text not null,
  permalink text,
  posted_at timestamptz,
  likes integer,
  comments integer,
  caption text not null,
  fetched_at timestamptz not null default now(),
  constraint voice_samples_page check (
    (page_kind = 'promoter' and artist_id is null)
    or (page_kind = 'artist' and artist_id is not null)
  ),
  constraint voice_samples_page_media unique nulls not distinct (client_id, artist_id, ig_media_id)
);

comment on table voice_samples is
  'One Instagram caption, verbatim, for a promoter page (artist_id null) or an artist page. The writer''s tone. Deleting the artist deletes that page''s rows. Deleting the client deletes both. Migration 215.';
comment on column voice_samples.id is
  'Primary key.';
comment on column voice_samples.user_id is
  'Owner. The Lab tables key their policy on user_id, and this row follows that.';
comment on column voice_samples.page_kind is
  'promoter or artist. Promoter reads the client''s own Instagram. Artist reads that artist''s page.';
comment on column voice_samples.client_id is
  'The client this page belongs to. Cascade: deleting the client deletes its samples.';
comment on column voice_samples.artist_id is
  'Null on the promoter page. The artist on an artist page. Cascade: deleting the artist deletes that page''s samples and leaves the promoter page.';
comment on column voice_samples.ig_media_id is
  'Instagram media id. Unique with the page. Not shown in the product.';
comment on column voice_samples.permalink is
  'The post''s permalink. The sheet opens it behind an icon and never prints the URL.';
comment on column voice_samples.posted_at is
  'When the page posted it. The prompt takes the 30 most recent by this.';
comment on column voice_samples.likes is
  'like_count at the last read. Updated on every read.';
comment on column voice_samples.comments is
  'comments_count at the last read. Updated on every read.';
comment on column voice_samples.caption is
  'The caption verbatim, line breaks kept. Empty captions are not written.';
comment on column voice_samples.fetched_at is
  'When this row was last read from Instagram.';

alter table clients
  add column voice_hashtags_enabled boolean not null default false;

comment on column clients.voice_hashtags_enabled is
  'When true, the writer may put the page''s hashtag habit in the primary text. Default off: hashtags are read as a trait and not written. Mentions are never written. One switch for the client. Migration 215.';

alter table clients
  add column ig_last_error text;

comment on column clients.ig_last_error is
  'The last promoter-page read, in one sentence, or null when it succeeded. Not a trait. Migration 215.';

alter table voice_samples enable row level security;

create policy "Users can manage their own voice_samples"
  on voice_samples
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index voice_samples_promoter_fetched_idx
  on voice_samples (client_id, fetched_at)
  where page_kind = 'promoter';
