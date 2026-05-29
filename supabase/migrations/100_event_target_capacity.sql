-- 100_event_target_capacity.sql
--
-- Workstream A of the WC26 dashboard reconciliation (2026-05-29).
--
-- Adds a venue-total strategic capacity target, replicated across every
-- fixture row of an event_code. The dashboard's funnel-pacing math
-- currently derives venue capacity from SUM(events.capacity), but the
-- per-fixture allocated capacities returned by the 4thefans ticketing
-- API do not reliably sum to the venue total (e.g. WC26-MANCHESTER
-- SUM=13,538 vs true venue total 8,200; WC26-GLASGOW-O2 SUM=1,672 vs
-- 6,750). The Excel cross-reference (WC26_funnel_cross_reference.xlsx)
-- uses venue-total capacity as the strategic target.
--
-- Read contract (lib/dashboard/client-dashboard-aggregations.ts ->
-- aggregateSharedVenueCapacity): MAX(target_capacity) per event_code,
-- falling back to SUM(events.capacity) when target_capacity is NULL.
-- The fallback is SUM (not MAX) to preserve the pre-existing behaviour
-- for venues without a target set (KOC-*, non-WC26 clients), which the
-- canonical funnel already SUMs.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS target_capacity integer;

COMMENT ON COLUMN events.target_capacity IS
  'Venue-total target capacity (strategic target across all fixtures of this event_code). Falls back to SUM(events.capacity) when null. Per PR dashboard-WC26-reconciliation 2026-05-29.';

-- Data population (also applied to the live DB via Supabase MCP on
-- 2026-05-29). Kept here so a fresh DB / branch rebuild reproduces the
-- same WC26 venue targets. Values sourced from Matas's Excel.
UPDATE events SET target_capacity = 3240  WHERE event_code = 'WC26-ABERDEEN';
UPDATE events SET target_capacity = 3075  WHERE event_code = 'WC26-BIRMINGHAM';
UPDATE events SET target_capacity = 2768  WHERE event_code = 'WC26-BOURNEMOUTH';
UPDATE events SET target_capacity = 10250 WHERE event_code = 'WC26-BRIGHTON';
UPDATE events SET target_capacity = 2706  WHERE event_code = 'WC26-BRISTOL';
UPDATE events SET target_capacity = 5478  WHERE event_code = 'WC26-EDINBURGH';
UPDATE events SET target_capacity = 6750  WHERE event_code = 'WC26-GLASGOW-O2';
UPDATE events SET target_capacity = 4080  WHERE event_code = 'WC26-GLASGOW-SWG3';
UPDATE events SET target_capacity = 3957  WHERE event_code = 'WC26-LEEDS';
UPDATE events SET target_capacity = 4715  WHERE event_code = 'WC26-LONDON-KENTISH';
UPDATE events SET target_capacity = 2060  WHERE event_code = 'WC26-LONDON-SHEPHERDS';
UPDATE events SET target_capacity = 2132  WHERE event_code = 'WC26-LONDON-SHOREDITCH';
UPDATE events SET target_capacity = 2411  WHERE event_code = 'WC26-LONDON-TOTTENHAM';
UPDATE events SET target_capacity = 8200  WHERE event_code = 'WC26-MANCHESTER';
UPDATE events SET target_capacity = 1538  WHERE event_code = 'WC26-MARGATE';
UPDATE events SET target_capacity = 4100  WHERE event_code = 'WC26-NEWCASTLE';
