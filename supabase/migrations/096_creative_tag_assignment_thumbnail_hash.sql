-- PR cc/autotag-haiku-efficiency — content-hash dedup for the creative
-- auto-tagger.
--
-- The auto-tag cron (refresh-active-creatives) classifies a creative's
-- thumbnail with Claude. Many creatives are renames / duplicates of the same
-- underlying image, so re-tagging each one is wasted spend. We now key tagging
-- on a stable content hash of the thumbnail bytes (see
-- `hashAutoTagImage` in lib/intelligence/auto-tagger.ts) instead of the Meta
-- CDN URL, which carries rotating signature/expiry params.
--
-- This column stores that hash alongside each AI assignment so the dedup
-- survives across cron runs: when a later run encounters a creative whose
-- thumbnail hash already has tags (under the current model_version), it copies
-- the existing tags instead of calling Claude again. NULL for manual
-- assignments and for AI rows written before this migration.
--
-- The partial index targets the cron's lookup pattern — "the AI tags already
-- known for these thumbnail hashes on this event" — and mirrors the existing
-- `creative_tag_assignments_source_model_idx` (migration 068a) shape.

alter table creative_tag_assignments
  add column if not exists thumbnail_hash text;

create index if not exists creative_tag_assignments_thumbnail_hash_idx
  on creative_tag_assignments (event_id, source, model_version, thumbnail_hash)
  where thumbnail_hash is not null;

notify pgrst, 'reload schema';
