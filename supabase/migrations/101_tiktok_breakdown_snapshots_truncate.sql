-- Migration 101 — One-shot cache invalidation for tiktok_breakdown_snapshots
--
-- Before this migration, tiktok_breakdown_snapshots rows were keyed without
-- the campaign's optimization_goal. Post-deploy, the resolver picks the correct
-- conversion metric per campaign (complete_registration / complete_payment / …)
-- instead of always using video_play_actions. Stale rows from the old scheme
-- would show incorrect "Results" counts until naturally expired. Truncating on
-- deploy gives all clients a clean fetch against the new metric set.
--
-- Safe to run multiple times (TRUNCATE on an empty table is a no-op).

truncate table tiktok_breakdown_snapshots;

notify pgrst, 'reload schema';
