-- Migration 107: force re-fetch of Ironworks Spark Ad snapshots so the
-- corrected OEmbed thumbnail resolver (fetchSparkAdInfo) picks them up on
-- the next cron run.
--
-- Context: PR #523 wired fetchSparkAdInfo but used the wrong endpoint path
-- (/v1.3/spark_ads/posts/get/ → always 404). PR #524 switches to
-- TikTok's public OEmbed endpoint. Deleting the null-thumbnail rows forces
-- a full re-fetch that will call the corrected function.

DELETE FROM tiktok_active_creatives_snapshots
WHERE event_id = '68535c85-0394-435f-9439-245dd2e87043'
  AND thumbnail_url IS NULL;
