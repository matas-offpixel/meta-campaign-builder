-- Migration 117: flag ambiguous asset_name → event resolution for operator review

ALTER TABLE client_asset_queue
  ADD COLUMN IF NOT EXISTS event_match_ambiguous boolean NOT NULL DEFAULT false;
