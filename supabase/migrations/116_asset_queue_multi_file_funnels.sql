-- Migration 116: multi-file folder support + multi-funnel parsing for client_asset_queue
--
-- asset_blob_urls  — all uploaded file paths for folder rows (jsonb array of strings)
-- funnels          — all funnel labels from the sheet cell (e.g. ["TOFU","MOFU"])
-- media_file_count — count of successfully uploaded files from a folder
--
-- Existing rows are truncated (re-scrape required) because the column mapping
-- changes (funnels) affect hashing semantics for future inserts.

ALTER TABLE client_asset_queue
  ADD COLUMN IF NOT EXISTS asset_blob_urls jsonb,
  ADD COLUMN IF NOT EXISTS funnels text[],
  ADD COLUMN IF NOT EXISTS media_file_count int;

-- Backfill funnels from the existing funnel column for any surviving rows
UPDATE client_asset_queue
   SET funnels = ARRAY[funnel]
 WHERE funnel IS NOT NULL AND funnels IS NULL;

-- Clean slate — all existing rows were ingested before folder + multi-funnel support
TRUNCATE TABLE client_asset_queue;
