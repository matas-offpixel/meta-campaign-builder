-- Migration 199 — Creative Lab video is 9:16 only.
--
-- crop_focus_y stays the same column. Its meaning is now the vertical
-- centre of the 4:5 safe rectangle inside the 9:16 frame (0 top, 1 bottom).
-- 0.5 is centred. This migration only replaces the comment.
--
-- kind separates a video render from a static (M6). The Lab writes only
-- 9:16 for video. Statics will write 1:1, 4:5 and 9:16; nothing writes
-- them yet. The aspect column and its check stay as they are.
--
-- Unapplied. Matas applies.

comment on column creative_lab_clips.crop_focus_y is
  'Vertical centre of the 4:5 safe rectangle inside the 9:16 frame, as a fraction of the frame height. 0.5 is centred. lib/creative-lab/render.ts. Migration 199.';

alter table creative_lab_renders
  add column if not exists kind text not null default 'video';

alter table creative_lab_renders
  drop constraint if exists creative_lab_renders_kind_check;

alter table creative_lab_renders
  add constraint creative_lab_renders_kind_check check (kind in ('video', 'static'));

comment on column creative_lab_renders.kind is
  'video is 9:16 only. static (M6) will be 1:1, 4:5 or 9:16. Nothing writes static yet. Migration 199.';

notify pgrst, 'reload schema';
