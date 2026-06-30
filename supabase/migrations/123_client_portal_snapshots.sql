-- Migration 123 — client_portal_snapshots
-- (Claimed 123: disk topped at 119, but the prod ledger already consumed the
--  names 120/121/122 — mailchimp tag-tracking + the PR #639 P0 covering index
--  applied directly. 123 is the next integer free on both disk and ledger.)
--
-- Snapshot cache for the INTERNAL client portal payload
-- (`ClientPortalData` returned by `loadClientPortalByClientId` in
-- `lib/db/client-portal-server.ts`). Applies the PR #87 active-creatives
-- snapshot pattern to the internal dashboard so a cold `/clients/[id]`
-- (and `/clients/[id]/dashboard`) load serves a warm snapshot from
-- Postgres in <1s instead of re-running the 10+ step service-role
-- waterfall (~3-5s) on every request.
--
-- Differences from `active_creatives_snapshots` (migration 041):
--   * Scope is per-CLIENT, not per-event/per-share-token. Cache key is
--     `(client_id, build_version)` so a deploy with a new commit SHA
--     transparently bypasses stale rows (same invalidation contract as
--     migration 067's `build_version` column).
--   * This is an INTERNAL surface read by the owner's session, so RLS is
--     NOT service-role-only. A user may SELECT snapshots for clients they
--     own (join via `clients.user_id`, mirroring the
--     `client_report_weekly_snapshots` owner-read pattern from migration
--     014). Writes stay service-role only — the cron writer bypasses RLS
--     and there is deliberately no INSERT/UPDATE/DELETE policy.
--
-- Freshness window (15 min) is enforced by the reader
-- (`readClientPortalSnapshot`), not the table — a row older than the
-- window is treated as a miss and the caller falls back to a live load.
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: every statement is `if not exists` or wrapped in a DO block
-- that re-checks the catalog.

create table if not exists client_portal_snapshots (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references clients (id) on delete cascade,
  -- Stamped with VERCEL_GIT_COMMIT_SHA (||'dev' locally) so a deploy
  -- invalidates every prior snapshot without a manual purge — readers
  -- treat a mismatched build_version as a miss. Same contract migration
  -- 067 added to active_creatives_snapshots.
  build_version text        not null,
  -- Full `ClientPortalData` ok-payload. The shape is already JSON-safe
  -- (it ships over the wire to /api/share/client/[token]); a JSONB
  -- round-trip is lossless.
  payload_jsonb jsonb       not null,
  refreshed_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- One live row per (client, build). Upsert conflict target.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.client_portal_snapshots'::regclass
      and conname = 'client_portal_snapshots_client_build_key'
  ) then
    execute
      'alter table public.client_portal_snapshots '
      'add constraint client_portal_snapshots_client_build_key '
      'unique (client_id, build_version)';
  end if;
end $$;

-- Read-path index: latest snapshot for a client.
create index if not exists idx_client_portal_snapshots_lookup
  on client_portal_snapshots (client_id, refreshed_at desc);

-- ── RLS — owner read, service-role write ─────────────────────────────
alter table client_portal_snapshots enable row level security;

-- A user may read snapshots for clients they own. Joins through
-- `clients.user_id` (no denormalised user_id column on this table).
-- Writes have NO policy → only the service-role client (which bypasses
-- RLS) can insert/update, matching the cron-writer posture.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'client_portal_snapshots'
      and policyname = 'owner read client portal snapshots'
  ) then
    execute
      'create policy "owner read client portal snapshots" '
      'on client_portal_snapshots for select '
      'using (exists (select 1 from clients c '
      'where c.id = client_portal_snapshots.client_id '
      'and c.user_id = auth.uid()))';
  end if;
end $$;

comment on table client_portal_snapshots is
  'Snapshot cache of ClientPortalData per (client_id, build_version). Read by loadClientPortalByClientId for <1s warm dashboard loads; written by /api/cron/refresh-client-portal-snapshots (service-role). 15-min freshness enforced by the reader. Migration 123.';

notify pgrst, 'reload schema';
