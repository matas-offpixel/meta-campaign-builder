-- Migration 061 — Google Ads columns for event_daily_rollups
--
-- Mirrors the platform-specific rollup-column shape from migration 056 without
-- touching existing Meta or TikTok columns. These columns are owned by the
-- Google Ads rollup leg and stay separate so reporting can disaggregate paid
-- media by source.

alter table event_daily_rollups
  add column if not exists google_ads_spend        numeric(12,2),
  add column if not exists google_ads_impressions  integer,
  add column if not exists google_ads_clicks       integer,
  add column if not exists google_ads_conversions  integer,
  add column if not exists google_ads_video_views  integer,
  add column if not exists source_google_ads_at    timestamptz;

create index if not exists event_daily_rollups_event_date_google_ads_idx
  on event_daily_rollups (event_id, date)
  where google_ads_spend > 0;

notify pgrst, 'reload schema';
