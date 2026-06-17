-- 118_event_mailchimp_tag.sql
--
-- Per-event Mailchimp tag column + tag-scoped snapshot table.
--
-- Context: Ironworks (and similar multi-event clients) share one Mailchimp
-- audience across all shows. Each show is tagged with a unique label (e.g.
-- "Camelphat - London"). Without tag-scoping, share reports display the full
-- audience total (~4,054 contacts) as the Registrations figure for every event
-- — wrong for per-show reports and inflates CPR.
--
-- The fix:
--   1. events.mailchimp_tag — nullable, set per single-event row.
--      NULL → whole audience counted (brand_campaign default, no regression).
--      Non-null → cron reads tag member_count from Mailchimp segments API and
--      writes a row to mailchimp_tag_snapshots.
--   2. mailchimp_tag_snapshots — mirrors mailchimp_audience_snapshots in shape
--      but scoped to one tag (one event). Share report + internal dashboard
--      readers prefer this table when mailchimp_tag IS NOT NULL.
--
-- Backfill required after applying:
--   UPDATE events SET mailchimp_tag = 'Camelphat - London' WHERE event_code = 'IRW0004';
-- (Flag in PR description — to be run manually in Supabase SQL editor post-merge.)

-- ── 1. Add column to events ───────────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS mailchimp_tag TEXT;

COMMENT ON COLUMN events.mailchimp_tag IS
  'Mailchimp tag name used to scope registration counts to this event. '
  'When NULL, the whole audience is counted (brand_campaign default). '
  'Set per single-event row to filter signups to just that event''s tag.';

-- ── 2. Create mailchimp_tag_snapshots ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mailchimp_tag_snapshots (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL,
  event_id              UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  client_id             UUID        REFERENCES clients(id) ON DELETE SET NULL,
  mailchimp_audience_id TEXT        NOT NULL,
  mailchimp_tag         TEXT        NOT NULL,
  total_contacts        INTEGER     NOT NULL DEFAULT 0,
  email_subscribers     INTEGER     NOT NULL DEFAULT 0,
  snapshot_at           TIMESTAMPTZ NOT NULL,
  raw_json              JSONB
);

COMMENT ON TABLE mailchimp_tag_snapshots IS
  'Per-day tag-scoped Mailchimp member counts for events that share an audience. '
  'Preferred over mailchimp_audience_snapshots when events.mailchimp_tag IS NOT NULL.';

-- One row per event per calendar day (UTC). Expression index mirrors the
-- pattern used by mailchimp_audience_snapshots.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailchimp_tag_snapshots_event_day
  ON mailchimp_tag_snapshots (event_id, timezone('UTC', snapshot_at)::date);

CREATE INDEX IF NOT EXISTS idx_mailchimp_tag_snapshots_event_date
  ON mailchimp_tag_snapshots (event_id, snapshot_at DESC);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE mailchimp_tag_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tag_snapshots_owner_read" ON mailchimp_tag_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "tag_snapshots_service_write" ON mailchimp_tag_snapshots
  FOR ALL USING (auth.role() = 'service_role');
