-- Migration 108: force re-fetch after PR #525 (OEmbed User-Agent fix).
-- Deletes Ironworks Spark Ad snapshot rows that still have no thumbnail so
-- the next cron run calls the corrected fetchSparkAdInfo with the browser UA.

DELETE FROM tiktok_active_creatives_snapshots
WHERE event_id = '68535c85-0394-435f-9439-245dd2e87043'
  AND thumbnail_url IS NULL;
