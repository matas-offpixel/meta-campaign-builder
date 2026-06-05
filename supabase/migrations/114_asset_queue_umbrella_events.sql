-- Migration 114: umbrella event support for client_asset_queue
--
-- An "umbrella" row has location='All' and matches all venue mappings for a
-- given nation. Instead of a single resolved_event_code, it stores an array
-- of event codes and the first event's ID is stored in resolved_event_id as
-- an "anchor" event for bulk-attach URL routing.

-- New status value (idempotent — ADD VALUE IF NOT EXISTS)
ALTER TYPE asset_queue_status ADD VALUE IF NOT EXISTS 'matched_umbrella';

-- Array of all event codes matched by an umbrella row
ALTER TABLE client_asset_queue
  ADD COLUMN IF NOT EXISTS resolved_event_codes_multi text[];
