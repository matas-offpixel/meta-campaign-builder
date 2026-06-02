-- Separate engagement-style TikTok results (VIEW_CONTENT, etc.) from
-- conversion-style results (LEAD, COMPLETE_REGISTRATION, etc.).
ALTER TABLE event_daily_rollups
  ADD COLUMN IF NOT EXISTS tiktok_engagement_results integer;
