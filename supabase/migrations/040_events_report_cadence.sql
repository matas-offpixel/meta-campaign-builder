-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 040 — events.report_cadence
--
-- Adds an optional column controlling the *default* cadence the
-- DailyTracker / EventDailyReportBlock surfaces show on first paint
-- for this event.
--
-- Why we need it:
--   The shared tracker widget renders one row per calendar day for
--   the last 60 days. For events whose ticketing data only updates
--   weekly (e.g. Junction 2 / Bridge — promoter sends a Mon W/C
--   ticket report), six of every seven rows have null Tickets /
--   Revenue / CPT / ROAS columns and the running-tickets counter
--   stays at 0 for days at a time. Defaulting those events to the
--   weekly view (same data, ISO-week aggregation) makes the report
--   readable without losing the daily option for power users.
--
-- Shape:
--   text + check constraint instead of an enum — we expect this set
--   to expand (likely 'monthly' for awareness-only brand campaigns
--   later) and the migration cost of widening a check is lower than
--   altering an enum, especially with RLS in play.
--
-- Default 'daily' preserves current behaviour for every existing
-- event. The product team will run the per-event UPDATEs (Innervisions
-- + the J2 Bridge cohort) manually after this lands so we don't ship
-- a hardcoded event_code list that drifts when codes are renamed.
-- ─────────────────────────────────────────────────────────────────────────────

alter table events
  add column if not exists report_cadence text not null
    default 'daily'
    check (report_cadence in ('daily', 'weekly'));

comment on column events.report_cadence is
  'Default cadence the public share / internal report tracker opens on. '
  'Override is a per-session client-side toggle keyed by event id; this '
  'column controls the first-paint default.';
