-- Migration 112: client_asset_queue
-- One row per asset scraped from a client's Google Sheet. Deduplication is
-- by source_sheet_row_hash (sha256 of the raw row). Rows are never deleted —
-- status='launched' is terminal; history is preserved for audit.

CREATE TYPE asset_queue_status AS ENUM (
  'pending',    -- row hashed, venue matched, not yet prepared
  'matched',    -- venue resolved to an event; ready to be prepared
  'confirmed',  -- user has confirmed copy + targeting (reserved for future modal state)
  'launched',   -- Meta ads created; launched_meta_ad_ids populated
  'skipped',    -- user explicitly skipped this row
  'error'       -- unrecoverable error; see error_message
);

CREATE TABLE client_asset_queue (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- sha256(client_id || raw_row_json) — dedup key across scrapes
  source_sheet_row_hash   text NOT NULL,
  -- Raw sheet columns
  nation                  text,     -- England / Scotland / All
  location                text,     -- venue label as written by Joe
  funnel                  text,     -- TOFU / MOFU / BOFU
  asset_name              text,
  dropbox_url             text,
  notes                   text,
  -- Resolved event (set when status >= 'matched')
  resolved_event_id       uuid REFERENCES events(id),
  resolved_event_code     text,
  -- Processing state
  status                  asset_queue_status NOT NULL DEFAULT 'pending',
  error_message           text,
  -- Supabase Storage path after server-side download from Dropbox
  asset_blob_url          text,
  -- AI-generated copy (stored before user review — audit trail)
  generated_copy          text,
  generated_cta           text,
  generated_url           text,
  -- What the user changed at the confirm step (delta from generated_*)
  confirmed_overrides     jsonb,
  -- Meta ad IDs created on launch
  launched_meta_ad_ids    jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_asset_queue_unique UNIQUE (client_id, source_sheet_row_hash)
);

ALTER TABLE client_asset_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_asset_queue"
  ON client_asset_queue
  FOR ALL
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

CREATE INDEX client_asset_queue_client_status_idx
  ON client_asset_queue (client_id, status);

CREATE INDEX client_asset_queue_client_id_idx
  ON client_asset_queue (client_id);

CREATE INDEX client_asset_queue_created_at_idx
  ON client_asset_queue (client_id, created_at DESC);
