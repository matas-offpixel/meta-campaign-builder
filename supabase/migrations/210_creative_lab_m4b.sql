-- Migration 210 — Creative Lab M4b: thumbnails, the text check, and the 9:16 crop.
--
-- Write only. Not applied from this branch. Matas applies it after merge.

alter table creative_lab_clips
  add column if not exists crop_focus_x numeric not null default 0.5;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'creative_lab_clips_crop_focus_x_range'
  ) then
    alter table creative_lab_clips
      add constraint creative_lab_clips_crop_focus_x_range
      check (crop_focus_x >= 0 and crop_focus_x <= 1);
  end if;
end $$;

comment on column creative_lab_clips.crop_focus_x is
  'Horizontal centre of the 9:16 window on a source wider than 9:16, as a fraction of the spare width. 0 is the left edge, 1 the right, 0.5 the centre. crop_focus_y keeps its meaning from migration 199: the vertical centre of the 4:5 safe rectangle, not this window. Migration 210.';

alter table creative_lab_ig_candidates
  add column if not exists thumbnail_path text,
  add column if not exists overlay_check jsonb,
  add column if not exists asset_id uuid,
  add column if not exists clip_id uuid,
  add column if not exists checked_at timestamptz;

comment on column creative_lab_ig_candidates.thumbnail_path is
  'Object key in the creative-thumbnails bucket, creative-lab/ig/{artist_id}/{ig_media_id}.jpg. The thumbnail URL is never stored. Migration 210.';
comment on column creative_lab_ig_candidates.overlay_check is
  'Vision verdict for burned-in text: clean, text_overlay, or check_by_eye, with the eight frames. Null until the check runs. Migration 210.';
comment on column creative_lab_ig_candidates.asset_id is
  'The downloaded file in creative_assets. Null until import downloads it. Kept when the text check skips the clip. Migration 210.';
comment on column creative_lab_ig_candidates.clip_id is
  'The creative_lab_clips row written on import. Null until then. Migration 210.';
comment on column creative_lab_ig_candidates.checked_at is
  'When the burned-in text check last ran. Migration 210.';
