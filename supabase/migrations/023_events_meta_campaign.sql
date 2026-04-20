-- Migration 023 — Cache lifetime Meta campaign spend on the event row.
--
-- The client portal previously assumed `ad_spend_actual` (migration 022) was
-- a manual figure the admin would key in per event. That doesn't survive
-- contact with reality — events at the same venue share a single Meta
-- campaign, and the relevant number is the *campaign's* lifetime spend
-- divided across the events it covers.
--
-- Storage model:
--   meta_campaign_id     — Admin pastes the Meta campaign ID once per event
--                          (all events at the same venue share this value).
--                          Used as the join key for the on-demand refresh.
--   meta_spend_cached    — Snapshot of the campaign's lifetime spend at the
--                          time the admin last hit "Refresh". Stored on every
--                          event sharing the same meta_campaign_id so the
--                          portal can read it without an extra join. The
--                          divide-across-events split lives in the portal
--                          (computed at render), so a future re-grouping
--                          doesn't need a backfill.
--   meta_spend_cached_at — Wall-clock timestamp of the last successful
--                          refresh. Surfaced in the admin UI as
--                          "Last synced: …".
--
-- ad_spend_actual is intentionally retained on the row even though the
-- portal stops reading it — keeping the column avoids a destructive change
-- and leaves room to repurpose it later (e.g. a manual override path).
-- The defensive `add column if not exists ad_spend_actual` below is a
-- no-op in any environment that already ran 022; it just keeps this
-- migration idempotent for fresh databases.

alter table events
  add column if not exists meta_campaign_id     text,
  add column if not exists meta_spend_cached    numeric(12,2),
  add column if not exists meta_spend_cached_at timestamptz,
  add column if not exists ad_spend_actual      numeric(10,2);

comment on column events.meta_campaign_id is
  'Meta campaign ID covering this event. All events at the same venue share this value. Admin sets it; used to pull lifetime spend.';
comment on column events.meta_spend_cached is
  'Venue-level lifetime Meta spend; identical across every event sharing meta_campaign_id. Refreshed on demand via the admin "Refresh spend" action.';
comment on column events.meta_spend_cached_at is
  'Timestamp of the last successful meta_spend_cached refresh.';

notify pgrst, 'reload schema';
