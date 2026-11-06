-- Migration 204 — Creative Lab M4a: list an artist's Instagram clips.
--
-- Write only. Not applied from this branch. Claude applies it after merge.
-- No downloads, no clip rows, no Meta writes.

alter table clients
  add column if not exists instagram_business_id text;

comment on column clients.instagram_business_id is
  'The client''s Instagram business account id. Business Discovery reads an artist''s feed through this account when the artist''s own media edge cannot be read.';

alter table creative_lab_artists
  drop constraint if exists creative_lab_artists_approval_needs_rights;

alter table creative_lab_artists
  add column if not exists ig_synced_at timestamptz,
  add column if not exists ig_last_error text;

comment on column creative_lab_artists.rights_doc_ref is
  'Optional note. The Cleared tick (approved_at) is the rights record.';
comment on column creative_lab_artists.ig_synced_at is
  'When Instagram clips were last listed. Null until the first successful read.';
comment on column creative_lab_artists.ig_last_error is
  'The last Instagram listing failure, in plain words. Never a token or a media URL.';

alter table creative_lab_clips
  add column if not exists overlay_check jsonb,
  add column if not exists audio_match boolean;

comment on column creative_lab_clips.overlay_check is
  'M4b: the vision verdict for burned-in text. Null until that check runs.';
comment on column creative_lab_clips.audio_match is
  'True when Instagram copyright check found a music match. Null means unknown.';

create table if not exists creative_lab_ig_candidates (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  artist_id           uuid not null references creative_lab_artists (id) on delete cascade,
  ig_media_id         text not null,
  slide_ids           text[] not null default '{}',
  aspect              text,
  thumb_width         integer,
  thumb_height        integer,
  permalink           text,
  media_type          text,
  media_product_type  text,
  posted_at           timestamptz,
  likes               integer,
  comments            integer,
  followers_at_fetch  integer,
  score               numeric,
  has_file            boolean not null,
  file_source         text not null check (file_source in ('own_edge', 'none')),
  audio_match         boolean,
  status              text not null default 'candidate'
    check (status in ('candidate', 'requested', 'imported', 'skipped')),
  reason              text,
  fetched_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (artist_id, ig_media_id)
);

comment on table creative_lab_ig_candidates is
  'Instagram clips listed for an artist between runs. media_url is never stored: it expires and it is a file address. Migration 204.';
comment on column creative_lab_ig_candidates.slide_ids is
  'Other video slide ids of the same carousel, in carousel order. ig_media_id is the first video slide. A reel is empty. A carousel takes one of the eight slots.';
comment on column creative_lab_ig_candidates.aspect is
  '9:16, 4:5, 1:1, landscape, or unknown. Read from the thumbnail header. A reel with no readable thumbnail is 9:16. The thumbnail URL and the image are not stored.';
comment on column creative_lab_ig_candidates.thumb_width is
  'Thumbnail width in pixels, when the header could be read.';
comment on column creative_lab_ig_candidates.thumb_height is
  'Thumbnail height in pixels, when the header could be read.';
comment on column creative_lab_ig_candidates.file_source is
  'own_edge when the artist''s own media edge was read. none when Business Discovery only listed the post.';
comment on column creative_lab_ig_candidates.audio_match is
  'copyright_check_information.matches_found on the own edge. Null when that call was not made or failed.';
comment on column creative_lab_ig_candidates.status is
  'candidate until someone requests the file, imports it, or skips it.';

alter table creative_lab_ig_candidates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'creative_lab_ig_candidates'
      and policyname = 'Users can manage their own creative_lab_ig_candidates'
  ) then
    create policy "Users can manage their own creative_lab_ig_candidates"
      on creative_lab_ig_candidates
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  drop trigger if exists creative_lab_ig_candidates_updated_at on creative_lab_ig_candidates;
  create trigger creative_lab_ig_candidates_updated_at
    before update on creative_lab_ig_candidates
    for each row execute procedure update_updated_at_column();
end $$;
