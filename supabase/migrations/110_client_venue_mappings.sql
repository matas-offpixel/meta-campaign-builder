-- Migration 110: client_venue_mappings
-- Maps human-readable sheet labels (e.g. "Brighton") to internal event codes
-- (e.g. "WC26-BRIGHTON") on a per-client basis. One-time admin setup.

CREATE TABLE client_venue_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sheet_label     text NOT NULL,   -- exactly as Joe writes it in the sheet
  event_code      text NOT NULL,   -- your internal code (e.g. WC26-BRIGHTON)
  nation_label    text,            -- England / Scotland / All (informational)
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_venue_mappings_unique UNIQUE (client_id, sheet_label)
);

ALTER TABLE client_venue_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_venue_mappings"
  ON client_venue_mappings
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

CREATE INDEX client_venue_mappings_client_id_idx
  ON client_venue_mappings (client_id);

CREATE INDEX client_venue_mappings_label_lower_idx
  ON client_venue_mappings (client_id, lower(sheet_label));
