-- Migration 258 — the Lab video window (VW1–VW6,
-- docs/design-record/2026-11-17-creative-lab-video-window.html).
-- Written, not applied: Matas applies. Additive and idempotent.
--
-- drops is VW1's detection on the clip's own sound, read from the render
-- copy (O68) at import and by scripts/backfill-clip-drops.mts. The window
-- itself stays in in_s / out_s, which every render already reads; detection
-- and the picker write VW2's window there. A clip whose drops is null has
-- not been checked: its stored window stands until the backfill runs.

alter table creative_lab_clips
  add column if not exists drops jsonb,
  add column if not exists drops_at timestamptz,
  add column if not exists window_drop_s numeric,
  add column if not exists window_by_hand boolean not null default false;

alter table creative_lab_clips drop constraint if exists creative_lab_clips_window_drop_s_check;
alter table creative_lab_clips
  add constraint creative_lab_clips_window_drop_s_check
  check (window_drop_s is null or window_drop_s >= 0);

comment on column creative_lab_clips.drops is
  'VW1. {v: 1, status: "ok", assetId, durationS, hasSound, lufs, candidates: [{tS, riseDb}] in time order, mainS, peaks: [0..1]} or {v: 1, status: "failed", assetId, error}. assetId is the creative_assets row the sound was read from; a different render copy makes it stale. Null: not checked yet. Migration 258.';
comment on column creative_lab_clips.drops_at is
  'When drops was last written. Migration 258.';
comment on column creative_lab_clips.window_drop_s is
  'VW4. The candidate (a drops.candidates tS) the operator chose instead of the main drop, or null for the main drop. Never a time the sound does not show. Migration 258.';
comment on column creative_lab_clips.window_by_hand is
  'VW5. True once the operator nudged the window (" · set by hand"); "Back to the detected window" sets it false. Migration 258.';
