-- Migration 087 — audience_source_cache
--
-- DB-backed cache for the Audience Builder's Meta source fetches
-- (campaigns, campaign-videos, multi-campaign-videos, pages, pixels).
-- Replaces the per-worker `Map` cache in `lib/audiences/source-cache.ts`,
-- which dies on every Vercel cold start. With a DB cache the second
-- user / second cold-start hits cache, killing the 20–40s Audience
-- Builder video-views fetch latency on J2-scale campaigns.
--
-- Note: project's previous migration is 086. The PR brief referred to
-- this as "migration 080"; renumbered to 087 to extend the live
-- sequence.
--
-- Cache contract:
--   * Keyed on (user_id, client_id, source_kind, cache_key).
--   * `expires_at` is now() + ttlMs at write time. Reads must check
--     expires_at > now().
--   * `build_version` stamped with VERCEL_GIT_COMMIT_SHA at write
--     time. Reads with mismatched / NULL build_version are treated
--     as stale (mirrors active_creatives_snapshots, mig 067).
--   * Writes are service-role only via the DB cache helper. The
--     SELECT policy below lets owners verify cache hits when
--     debugging without unlocking arbitrary writes.

create table if not exists audience_source_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  source_kind text not null check (
    source_kind in (
      'campaign-videos',
      'multi-campaign-videos',
      'campaigns',
      'pages',
      'pixels'
    )
  ),
  cache_key text not null,
  payload jsonb not null,
  payload_size_bytes integer generated always as (
    octet_length(payload::text)
  ) stored,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  build_version text,
  unique (user_id, client_id, source_kind, cache_key)
);

create index if not exists idx_audience_source_cache_lookup
  on audience_source_cache (user_id, client_id, source_kind, cache_key, expires_at);

alter table audience_source_cache enable row level security;

drop policy if exists audience_source_cache_owner_select
  on audience_source_cache;
create policy audience_source_cache_owner_select
  on audience_source_cache
  for select
  using (auth.uid() = user_id);

-- Writes are intentionally NOT exposed to authenticated users. The
-- DB cache helper runs under service-role and bypasses RLS. Adding an
-- INSERT/UPDATE policy here would let users seed arbitrary cached
-- payloads under their own user_id — exactly the trust boundary we
-- avoid on every other snapshot table.

notify pgrst, 'reload schema';
