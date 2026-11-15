-- Migration 203 — Creative Lab M3e: a shared folder of an artist's clips.
--
-- Write only. Not applied from this branch. Claude applies it after merge.
-- Does not launch anything.

alter table creative_lab_artists
  add column if not exists clip_folder_url text,
  add column if not exists clip_source text not null default 'file',
  add column if not exists clip_folder_synced_at timestamptz,
  add column if not exists clip_folder_last_error text;

alter table creative_lab_artists
  drop constraint if exists creative_lab_artists_clip_source_check;

alter table creative_lab_artists
  add constraint creative_lab_artists_clip_source_check
  check (clip_source in ('spark', 'file', 'instagram', 'presskit'));

comment on column creative_lab_artists.clip_folder_url is
  'Drive /drive/folders/… or a Dropbox shared-folder link. New clips are imported from this folder.';
comment on column creative_lab_artists.clip_source is
  'The source new imported clips get. Same set as creative_lab_clips.source.';
comment on column creative_lab_artists.clip_folder_synced_at is
  'When the folder was last listed. Null until the first successful list.';
comment on column creative_lab_artists.clip_folder_last_error is
  'The last folder-level failure, in plain words. Never the folder URL or a file id.';

alter table creative_lab_clips
  add column if not exists source_file_id text;

create unique index if not exists creative_lab_clips_artist_source_file_uidx
  on creative_lab_clips (artist_id, source_file_id)
  where source_file_id is not null;

comment on column creative_lab_clips.source_file_id is
  'Drive file id or Dropbox path of the imported file. Null for a clip added by hand.';
