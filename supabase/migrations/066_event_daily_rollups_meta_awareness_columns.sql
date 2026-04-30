-- Migration 063 — Meta awareness columns for event_daily_rollups
--
-- Adds Meta-owned awareness metrics alongside the existing legacy Meta spend /
-- clicks columns. These stay nullable until the rollup runner writes them.

alter table event_daily_rollups
  add column if not exists meta_impressions integer,
  add column if not exists meta_reach integer,
  add column if not exists meta_video_plays_3s integer,
  add column if not exists meta_video_plays_15s integer,
  add column if not exists meta_video_plays_p100 integer,
  add column if not exists meta_engagements integer;

create index if not exists event_daily_rollups_event_date_meta_imp_idx
  on event_daily_rollups (event_id, date)
  where meta_impressions is not null;

notify pgrst, 'reload schema';
