-- Migration 233 — where a caption or quote was placed (C7).
-- Written, not applied. Null is a render from before this: it stays at
-- today's spot and grows no placement line. Contrast is stored and never
-- a reason to refuse (C4).

alter table creative_lab_renders
  add column if not exists placement_center_y numeric,
  add column if not exists placement_scale numeric,
  add column if not exists face_share numeric,
  add column if not exists face_run_s numeric,
  add column if not exists contrast numeric;

comment on column creative_lab_renders.placement_center_y is
  'C7. The caption block centre, px at 1920. Null on a render made before placement.';
comment on column creative_lab_renders.placement_scale is
  'C7. Fraction of the standard caption size (1, 0.85, 0.75, 0.65). Null on a render made before placement.';
comment on column creative_lab_renders.face_share is
  'Share of samples whose upper face met the caption. Stored with the place.';
comment on column creative_lab_renders.face_run_s is
  'Longest run of samples with a face in the caption, seconds.';
comment on column creative_lab_renders.contrast is
  'C4. O40 contrast on the placed block, stored, never a refusal.';
