-- Migration 111: client_asset_sheet_config
-- Per-client Google Sheets connection + AI copy defaults for the asset queue.
-- The service account is shared with the sheet manually by the user; credentials
-- live in env vars (GOOGLE_SHEETS_SERVICE_ACCOUNT_*) and are never stored here.

CREATE TABLE client_asset_sheet_config (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  google_sheet_id         text NOT NULL,
  sheet_range             text NOT NULL DEFAULT 'Assets!A:G',
  -- Informational only — the actual credentials are in env vars.
  service_account_email   text,
  -- Per-funnel fallback copy when AI is unavailable.
  -- Shape: { TOFU: "...", MOFU: "...", BOFU: "..." }
  copy_templates          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- CTA values per funnel stage.
  cta_defaults            jsonb NOT NULL DEFAULT '{"TOFU":"WATCH_MORE","MOFU":"LEARN_MORE","BOFU":"GET_TICKETS"}'::jsonb,
  -- URL patterns per funnel; interpolated against matched event fields.
  destination_url_pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_scraped_at         timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_asset_sheet_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_sheet_config"
  ON client_asset_sheet_config
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
