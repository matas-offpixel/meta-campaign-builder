-- Creative Lab voice. A page's own captions, and the traits taken from them.
-- Written, not applied. Matas applies. No DDL from the branch.

create table voice_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page_kind text not null check (page_kind in ('promoter', 'artist')),
  page_ref uuid not null,
  ig_media_id text not null,
  permalink text,
  posted_at timestamptz,
  likes integer,
  comments integer,
  caption text not null,
  fetched_at timestamptz not null default now(),
  unique (page_kind, page_ref, ig_media_id)
);

comment on table voice_samples is
  'One Instagram caption, verbatim, for a promoter page (clients.id) or an artist page (creative_lab_artists.id). The writer''s tone. Migration 215.';
comment on column voice_samples.id is
  'Primary key.';
comment on column voice_samples.user_id is
  'Owner. The Lab tables key their policy on user_id, and this row follows that. The page itself is page_ref.';
comment on column voice_samples.page_kind is
  'promoter or artist. Promoter reads the client''s own Instagram. Artist reads that artist''s page.';
comment on column voice_samples.page_ref is
  'clients.id when page_kind is promoter. creative_lab_artists.id when page_kind is artist. No foreign key: the column points at one of two tables.';
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
  'The caption verbatim. Empty captions are not written.';
comment on column voice_samples.fetched_at is
  'When this row was last read from Instagram.';

create table voice_traits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page_kind text not null check (page_kind in ('promoter', 'artist')),
  page_ref uuid not null,
  sample_n integer not null,
  traits jsonb not null,
  computed_at timestamptz not null default now(),
  unique (page_kind, page_ref)
);

comment on table voice_traits is
  'One row per page. Traits the extractor took from that page''s voice_samples. Not written until 8 captions. Migration 215.';
comment on column voice_traits.id is
  'Primary key.';
comment on column voice_traits.user_id is
  'Owner. Same policy as voice_samples.';
comment on column voice_traits.page_kind is
  'promoter or artist. Matches voice_samples.page_kind.';
comment on column voice_traits.page_ref is
  'The same page as voice_samples.page_ref.';
comment on column voice_traits.sample_n is
  'How many captions the traits were computed from. Under 8, no traits row.';
comment on column voice_traits.traits is
  'Emoji set and rate, sign-off lines with counts, hashtag habit, sentence length, case habit, how the venue and the lineup are named, typical length band. A page that cannot be read stores { "error": "..." } and sample_n 0.';
comment on column voice_traits.computed_at is
  'When the traits were last computed.';

alter table clients
  add column voice_hashtags_enabled boolean not null default false;

comment on column clients.voice_hashtags_enabled is
  'When true, the writer may put the page''s hashtag habit in the primary text. Default off: hashtags are read as a trait and not written. One switch for the client, not per style. Migration 215.';

alter table voice_samples enable row level security;
alter table voice_traits enable row level security;

create policy "Users can manage their own voice_samples"
  on voice_samples
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage their own voice_traits"
  on voice_traits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index voice_samples_fetched_at_idx on voice_samples (page_kind, fetched_at);
