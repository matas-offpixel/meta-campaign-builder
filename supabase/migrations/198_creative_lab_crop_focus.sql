-- Migration 198 — Creative Lab: where a 4:5 crop sits in the source frame.
--
-- 4:5 is a same-width crop of the 9:16 source. crop_focus_y is the source
-- point (0 top, 1 bottom) that lands on the crop's vertical centre, so the
-- decks in a low-framed clip are not cut off. 0.5 is the middle.
-- The 9:16 render is the whole frame and ignores it.
--
-- Unapplied. Matas applies.

alter table creative_lab_clips
  add column if not exists crop_focus_y numeric not null default 0.5;

alter table creative_lab_clips
  drop constraint if exists creative_lab_clips_crop_focus_y_range;

alter table creative_lab_clips
  add constraint creative_lab_clips_crop_focus_y_range check (crop_focus_y between 0 and 1);

comment on column creative_lab_clips.crop_focus_y is
  'Vertical centre of the 4:5 crop, as a fraction of the source height. 0.5 is the middle. lib/creative-lab/render.ts. Migration 198.';

notify pgrst, 'reload schema';
