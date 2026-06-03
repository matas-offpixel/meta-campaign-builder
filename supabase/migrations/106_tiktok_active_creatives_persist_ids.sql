-- Migration 106: persist thumbnail-resolution source IDs on
-- tiktok_active_creatives_snapshots so the share-render path can retry
-- thumbnail lookup from a cached snapshot row instead of always requiring
-- a live API call.
--
-- Context: Spark Ads reference an organic TikTok post via tiktok_item_id
-- (not video_id). Without persisting these IDs, thumbnail_url stays NULL
-- forever after the first cached snapshot fetch.

ALTER TABLE tiktok_active_creatives_snapshots
  ADD COLUMN IF NOT EXISTS video_id       TEXT,
  ADD COLUMN IF NOT EXISTS image_ids      TEXT[],
  ADD COLUMN IF NOT EXISTS tiktok_item_id TEXT,
  ADD COLUMN IF NOT EXISTS identity_id    TEXT,
  ADD COLUMN IF NOT EXISTS identity_type  TEXT;

-- Backfill: delete Ironworks snapshot rows that have a NULL thumbnail_url
-- so the next share-page load triggers a fresh fetch that will populate
-- the new columns and resolve thumbnails via the Spark Ad endpoint.
-- event_id = Ironworks IRWOHD event.
DELETE FROM tiktok_active_creatives_snapshots
WHERE event_id = '68535c85-0394-435f-9439-245dd2e87043'
  AND thumbnail_url IS NULL;
