-- Migration 064 — snapshot cache build-version invalidation

alter table active_creatives_snapshots
  add column if not exists build_version text;

alter table share_insight_snapshots
  add column if not exists build_version text;
