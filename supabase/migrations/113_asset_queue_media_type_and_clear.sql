-- Migration 113: add media_type column to client_asset_queue and clear stale rows
--
-- Background: the original sheet-parse column mapping was off by one. Rows
-- already in the DB have asset_name='Graphic'|'Video' (the type column) instead
-- of the real descriptive name. The hashes are also wrong (they were computed
-- from the incorrect assetName). Truncating is the cleanest fix — 35 rows
-- of data that are cheap to regenerate via a single re-scrape.
--
-- Apply BEFORE deploying the fixed sheet-parse code.

ALTER TABLE client_asset_queue
  ADD COLUMN IF NOT EXISTS media_type text;  -- 'Graphic' | 'Video' | other values Joe uses

-- Clear all stale rows so re-scrape produces correct hashes and names.
-- History note: all rows pre-migration had asset_name='Graphic'|'Video' (wrong).
TRUNCATE TABLE client_asset_queue;
