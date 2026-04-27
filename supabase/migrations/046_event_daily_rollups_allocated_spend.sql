-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 046 — per-event allocated ad spend
--
-- Adds three numeric columns to `event_daily_rollups` to support the
-- per-event spend attribution model introduced in PR D2.
--
-- Motivation
--   Multi-match venues (e.g. 4× England matches at one venue) used to
--   see campaign spend divided equally across matches regardless of
--   whether any creatives were game-specific. Clients watching
--   Ads Manager see that spend routing disproportionately to a single
--   opponent's creatives, so the flat 1/N split feels wrong.
--
--   The allocator (lib/dashboard/venue-spend-allocation.ts) now classes
--   each ad as either opponent-specific (matched on the ad name) or
--   venue-generic (no opponent in the name), and splits the generic
--   pool across every event at the venue. These three columns persist
--   the per-(event, day) result of that classification.
--
-- Columns (all nullable, all numeric(12, 2) to match the existing
-- ad_spend column):
--
--   - ad_spend_allocated       : specific + generic_share; the value
--                                the venue card surfaces in the
--                                per-event Ad Spend column once
--                                allocation has run.
--   - ad_spend_specific        : spend from ads whose name matched
--                                this event's opponent.
--   - ad_spend_generic_share   : this event's share of the venue-wide
--                                generic pool.
--
--   Existing `ad_spend` stays untouched and continues to carry the
--   per-day, per-event Meta spend the rollup-sync already stored.
--   The new columns live alongside it. Reporting reads
--   `ad_spend_allocated` when populated and falls back to `ad_spend`
--   when null (unallocated rows — e.g. solo-event venues where
--   allocation is a no-op and the runner intentionally leaves the
--   column null).
--
-- Backfill
--   None. Existing rows stay NULL; the next rollup-sync run writes
--   allocation values going forward. Keeping the rollout soft means
--   the feature can ship without a long-running migration and without
--   blocking the deployment on a complete backfill pass — cron hits
--   every event within ~6 hours anyway.
--
-- RLS
--   No policy changes required — the new columns inherit the existing
--   `edr_owner_*` policies on `event_daily_rollups`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table event_daily_rollups
  add column if not exists ad_spend_allocated     numeric(12, 2),
  add column if not exists ad_spend_specific      numeric(12, 2),
  add column if not exists ad_spend_generic_share numeric(12, 2);

comment on column event_daily_rollups.ad_spend_allocated is
  'Per-event allocated spend (ad_spend_specific + ad_spend_generic_share). NULL means allocation has not run — reporting falls back to ad_spend.';
comment on column event_daily_rollups.ad_spend_specific is
  'Spend from Meta ads whose name whole-word matched this event''s opponent (see lib/db/event-opponent-extraction.ts).';
comment on column event_daily_rollups.ad_spend_generic_share is
  'This event''s share of the venue-wide generic (no-opponent-in-name) ad pool, split evenly across every event at the venue.';

notify pgrst, 'reload schema';
