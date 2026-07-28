-- PR cursor/creator/autotag-cost-reduction — cross-event content-hash dedup
-- for the creative auto-tagger.
--
-- Migration 096 added `creative_tag_assignments.thumbnail_hash` and an index
-- scoped to (event_id, source, model_version, thumbnail_hash) — perfect for
-- "has THIS event already tagged this image", which is what the cron used it
-- for at the time. It is NOT usable for a global "has ANY event already
-- tagged this image" lookup, because event_id is the leading column.
--
-- Recurring creative assets (templated designs, generic stock imagery, the
-- same artwork reused across an artist's shows) are common across DIFFERENT
-- events/clients, not just within one event's own history. The auto-tag cron
-- now also checks a global hash lookup before falling back to a fresh Claude
-- call (see `resolveKnownTagsByHash` in
-- app/api/cron/refresh-active-creatives/route.ts), scoped to `source = 'ai'`
-- and a 30-day recency window so stale/superseded taxonomy tags don't leak
-- forward forever. This index makes that query
-- (`WHERE thumbnail_hash = ANY($1) AND source = 'ai' AND model_version = $2
-- AND created_at > $3`) an index-only scan instead of a sequential scan.

create index if not exists creative_tag_assignments_thumbnail_hash_global_idx
  on creative_tag_assignments (thumbnail_hash, source, model_version, created_at desc)
  where thumbnail_hash is not null and source = 'ai';

notify pgrst, 'reload schema';
