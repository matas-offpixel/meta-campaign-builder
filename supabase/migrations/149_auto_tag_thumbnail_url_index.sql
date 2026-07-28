-- PR cursor/creator/autotag-cost-reduction — Lever 5: Supabase Storage
-- thumbnail byte cache for the creative auto-tagger.
--
-- The auto-tagger caches downloaded Meta thumbnail bytes in the existing
-- `creative-thumbnails` Storage bucket (migration 068e), keyed by content
-- hash, so a URL resolved more than once (e.g. `scripts/validate-ai-tagging.ts`
-- running the same snapshot through two `--model` values back to back) skips
-- a redundant Meta/CDN fetch on the second attempt.
--
-- The cache is looked up BY URL (the caller doesn't know the content hash
-- until bytes are downloaded), so it needs a url -> content-hash index. That
-- index was first attempted as a second Storage object (a small JSON
-- manifest per URL) but `creative-thumbnails.allowed_mime_types` is
-- image-only (068e) and silently rejects non-image uploads (Storage returns
-- an error result rather than throwing, which a live smoke test caught).
-- Rather than widen an existing bucket's mime allow-list for an unrelated
-- consumer, the index lives in Postgres — its natural home anyway.
create table if not exists auto_tag_thumbnail_url_index (
  url_hash text primary key,
  content_hash text not null,
  content_type text not null,
  created_at timestamptz not null default now()
);

comment on table auto_tag_thumbnail_url_index is
  'Lever 5 (autotag cost reduction): sha256(thumbnail URL) -> content hash + content type, resolving to a Storage blob at creative-thumbnails/auto-tag/hash/{content_hash}.{ext}. See lib/intelligence/auto-tag-thumbnail-cache.ts.';

create index if not exists auto_tag_thumbnail_url_index_created_at_idx
  on auto_tag_thumbnail_url_index (created_at);

-- Service-role only (the cron + validation script use the service-role
-- client, which bypasses RLS). No anon/authenticated policies are defined —
-- this is an internal cache index, never read or written by end users.
alter table auto_tag_thumbnail_url_index enable row level security;

notify pgrst, 'reload schema';
