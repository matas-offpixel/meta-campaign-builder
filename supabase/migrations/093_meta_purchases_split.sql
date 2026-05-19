BEGIN;

-- PR #423 — Real Attribution Reconciliation v2 (Layer A).
--
-- Today `event_daily_rollups.meta_regs` is a single integer that
-- pools every Meta conversion event Meta reports against this
-- (event_id, date) — Lead, Registration, Purchase, etc. It was
-- adequate when 4thefans only optimised for Lead (the regs ≈ leads
-- approximation held). It is not adequate now that the dashboard
-- needs to compare Meta-reported PURCHASES against real ticket
-- sales and against Off/Pixel's own click→buy match graph.
--
-- This migration adds two purpose-built columns:
--
--   `meta_purchases` — sum of `actions` rows whose `action_type`
--                      starts with `offsite_conversion.fb_pixel_purchase`
--                      (also captures `_purchase_*` retina variants
--                      Meta sometimes splits to). Treated as the
--                      canonical "Meta claims X purchases" number on
--                      the new RealAttributionTile.
--
--   `meta_leads`     — sum of `lead`, `offsite_conversion.fb_pixel_lead`
--                      and `complete_registration` action types.
--                      Surfaced internally for funnel diagnostics.
--
-- `meta_regs` is intentionally kept untouched. The PR #422 surfaces
-- and the funnel-pacing module both read from it; rather than risk
-- a rename + downstream-renumbering churn, the cron writer keeps
-- writing the same broad-bucket sum to `meta_regs` as it does today,
-- so existing queries / callers see no behavioural change.
--
-- Both new columns default to 0 (NOT NULL) so:
--   - existing rows backfill cheaply (UPDATE … SET … = 0 — Postgres
--     can rewrite in place since the default is non-null);
--   - aggregations like `SUM(meta_purchases)` never have to
--     COALESCE.
--
-- A partial index targets the typical "venue with at least one
-- Meta purchase day" lookup pattern. We mirror the exact shape of
-- the existing `event_daily_rollups_event_date_meta_imp_idx`
-- (migration 066) — `WHERE column IS NOT NULL` — so plan generation
-- stays consistent across the Meta column family.

ALTER TABLE event_daily_rollups
  ADD COLUMN IF NOT EXISTS meta_purchases integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meta_leads integer DEFAULT 0;

COMMENT ON COLUMN event_daily_rollups.meta_purchases IS
  'Sum of Meta `actions` rows with action_type matching the '
  'offsite_conversion.fb_pixel_purchase family per (event_id, date). '
  'Powers the RealAttributionTile "Meta claims X purchases" number '
  'and the campaigns-tab Meta CPA column when '
  'OFFPIXEL_REAL_ATTRIBUTION_ENABLED is set. Defaults to 0 — a '
  'non-null zero is the honest value before the Meta-purchase split '
  'cron runs against historical days.';

COMMENT ON COLUMN event_daily_rollups.meta_leads IS
  'Sum of Meta `actions` rows with action_type in '
  '(lead, offsite_conversion.fb_pixel_lead, complete_registration) '
  'per (event_id, date). Internal-only diagnostic; not surfaced on '
  'client-facing tiles. Defaults to 0.';

-- Partial indices mirror the meta_impressions pattern from
-- migration 066. We deliberately keep them non-unique — the
-- (event_id, date) PK already enforces uniqueness; these speed up
-- "venues with any Meta purchase / lead activity" filters.
CREATE INDEX IF NOT EXISTS event_daily_rollups_event_date_meta_purchases_idx
  ON event_daily_rollups (event_id, date)
  WHERE meta_purchases IS NOT NULL AND meta_purchases > 0;

CREATE INDEX IF NOT EXISTS event_daily_rollups_event_date_meta_leads_idx
  ON event_daily_rollups (event_id, date)
  WHERE meta_leads IS NOT NULL AND meta_leads > 0;

NOTIFY pgrst, 'reload schema';

COMMIT;
