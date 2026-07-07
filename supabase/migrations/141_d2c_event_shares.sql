-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 141 — d2c_event_shares (public read-only share links for the D2C
-- event dashboard). A share token exposes the aggregated per-event dashboard
-- (signup counts + scheduled-send previews) at /share/d2c/{token} with NO
-- individual PII and NO approval controls.
--
-- Security model (mirrors report_shares):
--   * The token IS the credential — 32-char URL-safe random, UNIQUE.
--   * Admin CRUD is RLS-scoped to the creating operator (`user_id = auth.uid()`).
--   * PUBLIC read on token match is NOT granted via RLS; the /share route reads
--     with the service-role client (bypassing RLS) after resolving the token.
--     No public SELECT policy exists, so an anon PostgREST call sees nothing.
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: guarded with IF NOT EXISTS / drop-then-create on policies.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.d2c_event_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  accessed_count integer not null default 0,
  last_accessed_at timestamptz
);

comment on table public.d2c_event_shares is
  'Public read-only share links for the D2C event dashboard (/share/d2c/{token}). Token is the credential; public reads go through the service-role client in the route, not RLS. Migration 141.';

create index if not exists d2c_event_shares_token_idx
  on public.d2c_event_shares (token);
create index if not exists d2c_event_shares_event_idx
  on public.d2c_event_shares (event_id);
create index if not exists d2c_event_shares_user_idx
  on public.d2c_event_shares (user_id);

alter table public.d2c_event_shares enable row level security;

-- Admin CRUD: the creating operator owns their share rows. (Cross-operator
-- reads on the operator dashboard use the service-role client, same as the
-- dashboard data reads — RLS here only guards direct PostgREST access.)
drop policy if exists "owner manages own d2c shares" on public.d2c_event_shares;
create policy "owner manages own d2c shares"
  on public.d2c_event_shares
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from information_schema.tables
  where table_schema = 'public' and table_name = 'd2c_event_shares';
  if v_count <> 1 then
    raise exception 'migration 141 verification: d2c_event_shares table missing';
  end if;

  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public' and tablename = 'd2c_event_shares'
    and indexname = 'd2c_event_shares_token_idx';
  if v_count <> 1 then
    raise exception 'migration 141 verification: token index missing';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'd2c_event_shares'
    and policyname = 'owner manages own d2c shares';
  if v_count <> 1 then
    raise exception 'migration 141 verification: owner RLS policy missing';
  end if;

  raise notice 'migration 141 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
