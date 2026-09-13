-- Migration 176 — meta_ad_id / meta_creative_id on creative_tag_assignments
--
-- Assignments currently key on (event_id, creative_name, tag_id) — a
-- display-name string. The cross-event patterns tile joins on that
-- string and breaks on rename. These columns are additive and nullable.
-- Phase 1 changes the join once they are populated. Do not change
-- creative-patterns-cross-event.ts in the same PR as this migration.
--
-- Apply by hand: prod first, then CI, only when the PR is about to merge.

alter table creative_tag_assignments
  add column if not exists meta_ad_id text;

alter table creative_tag_assignments
  add column if not exists meta_creative_id text;

create index if not exists creative_tag_assignments_meta_ad_id_idx
  on creative_tag_assignments (meta_ad_id)
  where meta_ad_id is not null;

comment on column creative_tag_assignments.meta_ad_id is
  'Meta ad id in hand at autotag time. Nullable. Phase 1 join key. Migration 176.';
comment on column creative_tag_assignments.meta_creative_id is
  'Meta creative id in hand at autotag time. Nullable. Migration 176.';

notify pgrst, 'reload schema';
