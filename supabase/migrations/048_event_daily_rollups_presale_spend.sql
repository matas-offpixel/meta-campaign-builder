-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 048 — per-event presale ad spend
--
-- Adds `ad_spend_presale numeric(12, 2)` to `event_daily_rollups` so the
-- allocator can separate presale-phase campaign spend from on-sale spend
-- before running the opponent-matching algorithm introduced in PR D2.
--
-- Motivation
--   PR D2's allocator summed every Meta campaign matching `[event_code]`
--   into the per-event `ad_spend_allocated` column. That double-counted
--   presale spend on dashboards whose PRE-REG column already aggregates
--   the same presale campaigns (split evenly across events). Verified on
--   4theFans Brighton: PRE-REG £1,704 + AD SPEND £3,344 = £5,049, which
--   overstates the true Meta total of £3,328 by £1,721.
--
--   The fix moves presale-campaign spend into its own bucket:
--
--     - Presale campaigns (name contains "PRESALE") no longer enter the
--       allocator. Their per-day spend is summed and split evenly across
--       every event in the venue, written to `ad_spend_presale`.
--     - Non-presale campaigns (Feed Post Traffic, ONSALE, ONSALE
--       Relaunch, …) continue to flow through the allocator → the
--       existing `ad_spend_*` trio. AD SPEND now reflects only ad spend
--       eligible for opponent attribution.
--
--   The PRE-REG column on the venue card reads `ad_spend_presale` when
--   populated (falling back to `events.prereg_spend` for legacy rows
--   where the allocator hasn't run). AD SPEND continues to read
--   `ad_spend_allocated`. The two columns now reconcile cleanly with
--   the underlying Meta total.
--
-- Column
--   ad_spend_presale : per-event share of the venue's presale-campaign
--                      spend for this day. Nullable numeric(12, 2) to
--                      match the ad_spend_* sibling columns. NULL means
--                      the allocator hasn't written for this row yet;
--                      reporting falls back to events.prereg_spend in
--                      that case so legacy dashboards keep working.
--
-- Backfill
--   None. Existing rows stay NULL; next rollup-sync run writes presale
--   values going forward. Same soft-rollout approach as migration 046.
--
-- RLS
--   No policy changes required — inherits existing edr_owner_* policies.
-- ─────────────────────────────────────────────────────────────────────────────

alter table event_daily_rollups
  add column if not exists ad_spend_presale numeric(12, 2);

comment on column event_daily_rollups.ad_spend_presale is
  'Presale-campaign spend (campaigns matching [event_code] AND name contains PRESALE), split evenly across events at the venue. Powers the PRE-REG column on the dashboard. NULL means allocation has not run — reporting falls back to events.prereg_spend.';

notify pgrst, 'reload schema';
