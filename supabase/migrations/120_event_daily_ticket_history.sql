-- Migration 120: event_daily_ticket_history
--
-- Adds a table that stores TRUE per-day attendee counts sourced directly from
-- provider APIs (Eventbrite orders expand=attendees, 4TheFans /sales deltas),
-- rather than computed by diffing cumulative ticket_sales_snapshots rows.
--
-- Background: audit (PR #634 / 4thefans_ticket_audit_2026-06-22.md) identified
-- three classes of inaccuracy in the cumulative-diff approach:
--   1. Intraday refunds cancel out across a snapshot window but vanish when
--      only the start and end snapshots are diffed.
--   2. Overnight sales at 22:xx get attributed to the next day when only the
--      early-morning EOD snapshot lands.
--   3. Source sync dropouts produce a negative diff on the next successful
--      snapshot, collapsing multiple real days into one number.
--
-- This table is ADDITIVE — ticket_sales_snapshots is NOT modified.
-- The canonical-tickets-resolver and event_daily_rollups.tickets_sold are
-- NOT changed by this migration; switching those consumers is a separate sprint.

CREATE TABLE IF NOT EXISTS event_daily_ticket_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id       uuid        NOT NULL REFERENCES events(id)     ON DELETE CASCADE,
  date           date        NOT NULL,
  source         text        NOT NULL
                   CHECK (source IN ('eventbrite_orders', 'fourthefans_history')),
  tickets_sold   integer     NOT NULL DEFAULT 0,
  -- Revenue stored in minor units (pence / cents) to avoid floating-point
  -- drift; divide by 100 in application code when displaying as pounds/euros.
  revenue_minor  bigint      NOT NULL DEFAULT 0,
  currency       text,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, date, source)
);

-- Fast look-up by event + descending date (most-recent-first reads).
CREATE INDEX idx_edth_event_date
  ON event_daily_ticket_history (event_id, date DESC);

-- RLS: each user sees only their own rows.
ALTER TABLE event_daily_ticket_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own rows"
  ON event_daily_ticket_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service-role INSERT / UPSERT paths do not go through RLS (they bypass it),
-- so cron + admin routes can write freely. No authenticated-user INSERT policy
-- is created because this table is written exclusively by server-side code.
