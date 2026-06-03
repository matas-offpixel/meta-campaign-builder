-- migration 105: expire active_creatives_snapshots rows older than 12 hours
-- so the next share-page view triggers a fresh fetch + thumbnail re-enrichment.
-- This is a one-time repair for snapshots whose thumbnail_url entries inside
-- the JSONB payload may have been persisted without the video_id fallback path
-- (introduced in the same PR as this migration).

UPDATE active_creatives_snapshots
SET expires_at = NOW() - INTERVAL '1 second'
WHERE fetched_at < NOW() - INTERVAL '12 hours'
  AND (expires_at IS NULL OR expires_at > NOW());
