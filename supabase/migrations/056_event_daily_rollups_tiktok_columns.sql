-- Migration 056 — TikTok columns for event_daily_rollups
--
-- ad_spend / link_clicks remain Meta-only per the budget model documented in
-- docs/STRATEGIC_REFLECTION_2026-04-23.md and project_budget_model_2026-04-24
-- memory. Per-platform totals are stored as separate columns so paid-media
-- reporting can disaggregate by source without breaking existing Meta callers.

alter table event_daily_rollups
  add column if not exists tiktok_spend          numeric(12,2) default 0,
  add column if not exists tiktok_impressions    integer       default 0,
  add column if not exists tiktok_clicks         integer       default 0,
  add column if not exists tiktok_video_views    integer       default 0,
  add column if not exists tiktok_results        integer       default 0,
  add column if not exists source_tiktok_at      timestamptz;

create index if not exists event_daily_rollups_event_date_tiktok_idx
  on event_daily_rollups (event_id, date)
  where tiktok_spend > 0;

notify pgrst, 'reload schema';
