-- 119_mailchimp_bulletproof_tracking.sql
--
-- Layered, scale-safe Mailchimp tag tracking architecture.
--
-- Background: the synchronous per-member backfill (PR #629) re-fetches every
-- contact's tags on every request, which times out at Ironworks scale
-- (6 events x 5k+ contacts). This migration adds the schema for a layered
-- design:
--
--   1. mailchimp_tag_event_log     — append-only webhook audit log of
--      individual tag add/remove events (real-time growth signal).
--   2. mailchimp_tag_backfill_jobs — resumable one-time historical backfill
--      job tracking (chunked, cursor-based, survives deploys/timeouts).
--   3. mailchimp_tag_snapshots.day — generated date column + index for fast
--      "latest count per day" reads.
--
-- All new per-day writes (webhook recompute, EOD cron, backfill chunks) use a
-- deterministic snapshot_at of `${day}T12:00:00Z`, so the EXISTING unique index
-- `uq_mailchimp_tag_snapshots_event_snapshot_at (event_id, snapshot_at)`
-- naturally dedupes to one row per day. We do NOT add a UNIQUE (event_id, day)
-- index because live data already contains multiple intra-day rows from the
-- legacy cron, and a unique constraint would fail without destructive dedupe.

-- ── 1. mailchimp_tag_event_log ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mailchimp_tag_event_log (
  id                    BIGSERIAL   PRIMARY KEY,
  event_id              UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  client_id             UUID        REFERENCES clients(id) ON DELETE SET NULL,
  user_id               UUID        NOT NULL,
  mailchimp_audience_id TEXT        NOT NULL,
  mailchimp_tag         TEXT        NOT NULL,
  member_email_hash     TEXT        NOT NULL, -- Mailchimp md5(lower(email))
  member_email_address  TEXT,                 -- nullable; webhook may omit
  action                TEXT        NOT NULL CHECK (action IN ('added', 'removed')),
  event_timestamp       TIMESTAMPTZ NOT NULL, -- Mailchimp fired_at, else now()
  raw_webhook_body      JSONB,
  inserted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE mailchimp_tag_event_log IS
  'Append-only audit log of individual Mailchimp tag add/remove events received '
  'via webhook. Drives real-time per-day snapshot recomputation and supports '
  'recompute/audit scenarios.';

CREATE INDEX IF NOT EXISTS idx_mailchimp_tag_event_log_event_day
  ON mailchimp_tag_event_log (event_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_mailchimp_tag_event_log_email_hash
  ON mailchimp_tag_event_log (member_email_hash);

-- Dedupe webhook re-delivery (Mailchimp retries on non-2xx).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailchimp_tag_event_log_dedupe
  ON mailchimp_tag_event_log (event_id, member_email_hash, action, event_timestamp);

ALTER TABLE mailchimp_tag_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tag_event_log_owner_read" ON mailchimp_tag_event_log
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "tag_event_log_service_write" ON mailchimp_tag_event_log
  FOR ALL USING (auth.role() = 'service_role');

-- ── 2. mailchimp_tag_backfill_jobs ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mailchimp_tag_backfill_jobs (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                  UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id                   UUID        NOT NULL,
  mailchimp_audience_id     TEXT        NOT NULL,
  mailchimp_tag             TEXT        NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused')),
  total_members             INTEGER,
  members_processed         INTEGER     NOT NULL DEFAULT 0,
  last_processed_member_hash TEXT,                 -- pagination cursor (offset-based here)
  error_count               INTEGER     NOT NULL DEFAULT 0,
  last_error                TEXT,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_progress_at          TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  summary                   JSONB
);

COMMENT ON TABLE mailchimp_tag_backfill_jobs IS
  'Tracks one-time resumable historical tag backfill jobs. A job is processed in '
  'chunks by /api/cron/mailchimp-backfill-tick; progress survives deploys and '
  'timeouts via members_processed cursor.';

CREATE INDEX IF NOT EXISTS idx_mailchimp_tag_backfill_jobs_event
  ON mailchimp_tag_backfill_jobs (event_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_mailchimp_tag_backfill_jobs_status
  ON mailchimp_tag_backfill_jobs (status, started_at ASC);

ALTER TABLE mailchimp_tag_backfill_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tag_backfill_jobs_owner_read" ON mailchimp_tag_backfill_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "tag_backfill_jobs_service_write" ON mailchimp_tag_backfill_jobs
  FOR ALL USING (auth.role() = 'service_role');

-- ── 3. mailchimp_tag_snapshots.day generated column ───────────────────────────
-- timezone('UTC', snapshot_at) is IMMUTABLE (proven by the existing expression
-- index using it), so it is valid in a STORED generated column.

ALTER TABLE mailchimp_tag_snapshots
  ADD COLUMN IF NOT EXISTS day DATE
  GENERATED ALWAYS AS ((timezone('UTC', snapshot_at))::date) STORED;

CREATE INDEX IF NOT EXISTS idx_mailchimp_tag_snapshots_event_day_col
  ON mailchimp_tag_snapshots (event_id, day DESC);
