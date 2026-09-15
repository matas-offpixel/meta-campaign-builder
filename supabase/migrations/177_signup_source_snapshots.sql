-- 177_signup_source_snapshots.sql
--
-- Per-day signup counts from Cirqlin (source of truth for REGISTRATIONS).
-- Same shape the Daily Tracker already reads from the Mailchimp snapshot
-- tables: one row per event per source per calendar day, with a running
-- total and the raw partner payload for the card's secondary lines.
--
-- Join key is events.mailchimp_tag ↔ Cirqlin pages.crm_base_tag.
-- No new column on events. Additive. Matas applies before this PR merges.
--
-- Read policy joins `events` for ownership instead of carrying a
-- denormalised `user_id` like the sibling Mailchimp snapshot tables.
-- Deliberate: this table is counts-only, the event row is the
-- ownership source of truth, and a copied user_id would drift.

CREATE TABLE IF NOT EXISTS signup_source_snapshots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source         TEXT        NOT NULL CHECK (source IN ('cirqlin')),
  day            DATE        NOT NULL,
  signups_day    INTEGER     NOT NULL DEFAULT 0,
  signups_total  INTEGER     NOT NULL DEFAULT 0,
  raw_json       JSONB,
  snapshot_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE signup_source_snapshots IS
  'Per-day signup counts from an external source (Cirqlin). '
  'signups_day is that day''s form submissions (spam excluded); '
  'signups_total is the source''s counted lifetime at capture time. '
  'No PII — counts only.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_signup_source_snapshots_event_source_day
  ON signup_source_snapshots (event_id, source, day);

CREATE INDEX IF NOT EXISTS idx_signup_source_snapshots_event_day
  ON signup_source_snapshots (event_id, day DESC);

ALTER TABLE signup_source_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signup_source_snapshots_owner_read" ON signup_source_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = signup_source_snapshots.event_id
        AND e.user_id = auth.uid()
    )
  );

CREATE POLICY "signup_source_snapshots_service_write" ON signup_source_snapshots
  FOR ALL USING (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
