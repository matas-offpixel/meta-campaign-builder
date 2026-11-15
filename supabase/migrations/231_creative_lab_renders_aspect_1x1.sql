-- Migration 231 — creative_lab_renders.aspect allows 1:1 (HD6).
--
-- Write only. Not applied from this branch; ops applies it from main.
-- Record: docs/design-record/2026-11-11-creative-lab-drive-owner-type.html,
-- HD6. Statics keep all three formats (O95: 9:16, 4:5 and 1:1), so a 1:1
-- static render row needs the check widened before any is filed from the
-- Lab. Additive only: every row the old check allowed (9:16, 4:5) is still
-- allowed, and nothing else on the table changes.

alter table creative_lab_renders drop constraint if exists creative_lab_renders_aspect_check;
alter table creative_lab_renders
  add constraint creative_lab_renders_aspect_check
  check (aspect in ('9:16', '4:5', '1:1'));

comment on column creative_lab_renders.aspect is
  '9:16 or 4:5 for video; 9:16, 4:5 or 1:1 for statics (kind = ''static''). Migration 197; 1:1 added in migration 231.';

notify pgrst, 'reload schema';
