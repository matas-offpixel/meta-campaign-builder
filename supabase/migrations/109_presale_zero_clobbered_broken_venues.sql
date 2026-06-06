-- 109_presale_zero_clobbered_broken_venues.sql
--
-- Stage B of PR #499 (presale clobber fix). Companion to the audit in
-- docs/dashboard-presale-overattribution-mechanism-2026-06-05.md (PR #543).
--
-- THE BUG (live on main before #499):
--   rollup-sync's Meta leg wrote the FULL venue presale total to EVERY
--   sibling row of a multi-fixture event_code. The venue allocator divides
--   presale correctly on the first sibling's sync, but siblings 2..N then
--   re-write the column back to the venue total (the allocator is batch-
--   deduped per client_id+event_code, so it does not re-run). SUM(presale)
--   per event_code inflates to N x truth on the venues that happened to end
--   their sync cycle on a clobbering Meta leg.
--
-- THE SOURCE FIX (#499, this PR's code): rollup-sync-runner.ts now writes
--   ad_spend_presale only on the engagement-owner sibling (ownedOrNull);
--   non-owners pass NULL and upsertMetaRollups omits NULL, so the allocator's
--   divided per-fixture share is preserved across subsequent sibling syncs.
--
-- WHY THIS MIGRATION ZEROS *BROKEN-ONLY* (not all multi-fixture venues):
--   The audit (§2b/§5b) verified that pure DB state CANNOT distinguish a
--   correctly even-split row (value = venue-day total / n) from a clobbered
--   replicated row (value = venue-day total): both make all siblings equal
--   per day. The previous draft of this migration zeroed ALL equal-valued
--   siblings, which would have dropped the currently-CORRECT even-split
--   venues (Brighton, Aberdeen, Margate) to GBP 0 in the deploy gap before
--   the backfill restores them — regressing Brighton +119 -> -1,585.
--
--   So we zero ONLY the 7 venues the audit verified as replicated/broken.
--   Even-split + mixed-correct venues (Brighton, Aberdeen, Margate,
--   Manchester) are LEFT UNTOUCHED — they already SUM to truth. Worst case,
--   if the backfill never runs, the only damage is the 7 already-3x-wrong
--   venues drop to 0; the correct venues are never disturbed.
--
-- SEQUENCING (audit §6.3): this migration + the one-shot historical backfill
--   (POST /api/admin/event-presale-backfill) must land together / the
--   backfill must run immediately after. The backfill re-runs the allocator
--   with an explicit historical `since` (the live 60-day cron cannot reach
--   the Jan-Apr 2026 presale windows), re-reading the Meta venue total per
--   day and writing the correct total/n share to every sibling.
--
-- Verified broken venues (audit 2c, client 37906506-...561a):
--   BIRMINGHAM, BOURNEMOUTH, BRISTOL, LEEDS, NEWCASTLE (4 fixtures, window
--   2026-01-13 -> 01-29); EDINBURGH, GLASGOW-SWG3 (3 fixtures, 2026-01-21 ->
--   01-26). All replicated (N x truth), all siblings equal per day.
--
-- PRE-FLIGHT (run as SELECT on a Supabase branch BEFORE applying to prod;
-- paste the per-event_code counts into the PR description):
--
--   SELECT e.event_code, COUNT(*) AS rows_to_zero,
--          ROUND(SUM(r.ad_spend_presale)::numeric, 2) AS presale_sum_before
--   FROM event_daily_rollups r
--   JOIN events e ON e.id = r.event_id
--   WHERE e.client_id = '37906506-56b7-4d58-ab62-1b042e2b561a'
--     AND e.event_code IN (
--       'WC26-BIRMINGHAM','WC26-BOURNEMOUTH','WC26-BRISTOL','WC26-LEEDS',
--       'WC26-NEWCASTLE','WC26-EDINBURGH','WC26-GLASGOW-SWG3')
--     AND r.ad_spend_presale IS NOT NULL AND r.ad_spend_presale > 0
--   GROUP BY e.event_code ORDER BY e.event_code;
--
--   Expected: only the 7 codes above; WC26-BRIGHTON / WC26-ABERDEEN /
--   WC26-MARGATE / WC26-MANCHESTER must NOT appear.

BEGIN;

UPDATE event_daily_rollups r
SET ad_spend_presale = 0
FROM events e
WHERE r.event_id = e.id
  AND e.client_id = '37906506-56b7-4d58-ab62-1b042e2b561a'
  AND e.event_code IN (
    'WC26-BIRMINGHAM',
    'WC26-BOURNEMOUTH',
    'WC26-BRISTOL',
    'WC26-LEEDS',
    'WC26-NEWCASTLE',
    'WC26-EDINBURGH',
    'WC26-GLASGOW-SWG3'
  )
  AND r.ad_spend_presale IS NOT NULL
  AND r.ad_spend_presale > 0;

COMMIT;
