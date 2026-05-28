-- Migration 099 — Rollup writer convergence: add landing_page_views columns
-- to event_daily_rollups and event_code_lifetime_meta_cache.
--
-- Context (issue #467 audit, PR-A):
--   Funnel-pacing convergence followup to the #437/#438/#440/#454/#459 arc.
--   Today the surface reads LPV from active_creatives_snapshots.payload
--   (snapshot blob, sibling-deduped) and reads clicks from
--   event_daily_rollups.link_clicks where the *writer* persists Meta's
--   narrow `inline_link_clicks` field.
--
--   This migration is the schema half of PR-A. It adds:
--     - event_daily_rollups.landing_page_views
--     - event_code_lifetime_meta_cache.meta_landing_page_views
--
--   The matching writer code in lib/insights/meta.ts + lib/insights/
--   event-code-lifetime-two-pass.ts + lib/dashboard/rollup-sync-runner.ts
--   lands in the same PR; it
--     (a) swaps inline_link_clicks → clicks (engagement-clicks) for both
--         writers, atomically, and
--     (b) extracts LPV from Meta's `actions[]` via the priority chain
--         omni_landing_page_view → offsite_conversion.fb_pixel_landing_page_view
--         → landing_page_view (mirroring the existing chain in
--         lib/reporting/active-creatives-fetch.ts:296-300).
--
--   `link_clicks` column NAME stays the same — only the metric it stores
--   shifts. Renaming would touch ~80 files in one commit; we instead
--   refresh the docstring on the writer and add a tooltip on the daily
--   tracker UI to flag the basis change. A column rename can land later
--   if the touchpoint count is ever worth it.
--
-- Nullable on purpose: pre-PR rows have no LPV value; the matching
-- one-time Meta-API backfill (app/api/admin/rollup-canonical-clicks-lpv-
-- backfill/route.ts) populates the historical 180-day window for every
-- active event_code, after which only the backfill window is null.

alter table event_daily_rollups
  add column if not exists landing_page_views integer;

alter table event_code_lifetime_meta_cache
  add column if not exists meta_landing_page_views integer;

notify pgrst, 'reload schema';
