-- The caption follows the footage's owner.
-- creative_lab_clips.owner is promoter or artist. artist_id stays set on
-- an artist clip and is null on a promoter clip. A promoter clip can
-- feature several of the event's artists. Nothing is deleted. A second
-- run does not overwrite an owner someone has already set.
-- Written, not applied.

alter table creative_lab_clips add column if not exists owner text;
alter table creative_lab_clips add column if not exists shown_on_event_id uuid references events (id) on delete set null;
alter table creative_lab_clips add column if not exists owner_set_by text;
alter table creative_lab_clips add column if not exists owner_set_at timestamptz;

-- Existing clips name an artist, so they are that artist's footage.
-- Puzzle 4th Birthday's 26 clips are in this set (Luke 21, Enzo 5).
update creative_lab_clips
set owner = 'artist'
where owner is null
  and artist_id is not null;

alter table creative_lab_clips alter column artist_id drop not null;

alter table creative_lab_clips drop constraint if exists creative_lab_clips_owner_check;
alter table creative_lab_clips
  add constraint creative_lab_clips_owner_check
  check (owner in ('promoter', 'artist'));

alter table creative_lab_clips drop constraint if exists creative_lab_clips_owner_artist_check;
alter table creative_lab_clips
  add constraint creative_lab_clips_owner_artist_check
  check (
    (owner = 'artist' and artist_id is not null)
    or (owner = 'promoter' and artist_id is null)
  );

create unique index if not exists creative_lab_clips_promoter_no
  on creative_lab_clips (shown_on_event_id, clip_no)
  where owner = 'promoter';

comment on column creative_lab_clips.owner is
  'promoter: the client''s own footage. artist: one named artist''s footage. Set at import, or by Whose footage is this. Migration 226.';
comment on column creative_lab_clips.shown_on_event_id is
  'The event a promoter clip is grouped on. Artist clips are still found through their artist. Migration 226.';
comment on column creative_lab_clips.owner_set_by is
  'Who last corrected the owner. Null when the import set it. Never shown. Migration 226.';

create table if not exists creative_lab_clip_features (
  clip_id    uuid not null references creative_lab_clips (id) on delete cascade,
  artist_id  uuid not null references creative_lab_artists (id) on delete cascade,
  set_by     text,
  set_at     timestamptz,
  primary key (clip_id, artist_id)
);

comment on table creative_lab_clip_features is
  'Artists a promoter clip features. The clip stays in the client''s footage group. Several artists are allowed. Migration 226.';

alter table creative_lab_clip_features enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'creative_lab_clip_features'
      and policyname = 'Users can manage features of their own clips'
  ) then
    create policy "Users can manage features of their own clips"
      on creative_lab_clip_features
      for all
      using (
        exists (
          select 1 from creative_lab_clips c
          where c.id = clip_id and c.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from creative_lab_clips c
          where c.id = clip_id and c.user_id = auth.uid()
        )
      );
  end if;
end $$;

-- A third-person Artist angle, and a retired status for generated first person.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
    where rel.relname = 'creative_lab_captions'
      and con.contype = 'c'
      and att.attname = 'style'
      and array_length(con.conkey, 1) = 1
  loop
    execute format('alter table creative_lab_captions drop constraint %I', r.conname);
  end loop;
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
    where rel.relname = 'creative_lab_captions'
      and con.contype = 'c'
      and att.attname = 'status'
      and array_length(con.conkey, 1) = 1
  loop
    execute format('alter table creative_lab_captions drop constraint %I', r.conname);
  end loop;
end $$;

alter table creative_lab_captions
  add constraint creative_lab_captions_style_check
  check (style in (
    'lineup', 'question', 'scarcity', 'social_proof',
    'venue', 'whats_next', 'artist_first_person', 'artist', 'experience', 'four_line', 'pov',
    'quote'
  ));

alter table creative_lab_captions
  add constraint creative_lab_captions_status_check
  check (status in ('proposed', 'approved', 'rejected', 'retired'));

comment on column creative_lab_captions.status is
  'proposed, approved, rejected, or retired. Retired is a generated first-person caption: it stays, it is not deleted, and it enters no new round. Migration 226.';
