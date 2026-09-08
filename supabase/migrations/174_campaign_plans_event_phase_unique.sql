-- Migration 174 — unique (event_id, phase) on campaign_plans
--
-- One phase per event should be structurally impossible to duplicate.
-- DO NOT APPLY until Matas deletes the Folamour junk rows. Applying this
-- now fails: three unnamed £0 rows share NX26-FOLAMOUR and will all
-- backfill to on_sale under 173.
--
--   20a94559-b03b-4c14-abf1-c0a6ac0be9a0  created 2026-09-07 21:15:38Z
--   c565fdde-1dda-4f6b-ab88-4345c0067c59  created 2026-09-07 22:05:27Z
--   18dab888-1aef-492c-8145-2f9c12550f9f  created 2026-09-07 22:25:28Z
-- All three: unnamed, total_daily_budget 0, 2026-09-07 → 2026-10-23,
-- event_id 565600ea-… (NX26-FOLAMOUR). Created while the canvas was
-- being walked on 7 Sep.
--
-- Deleting those rows is a destructive act on his data and is his to
-- authorise, not this PR's. 173 may be applied without this file.
--
-- NULL phases are allowed to repeat (Postgres UNIQUE treats NULL as
-- distinct). Jamie Jones has two underivable rows; they stay null.
--
-- Do not apply in this run.

alter table campaign_plans
  add constraint campaign_plans_event_id_phase_key
  unique (event_id, phase);
