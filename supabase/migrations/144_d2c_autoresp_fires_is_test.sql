-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 144 — d2c_autoresp_fires.is_test (operator "Send test to me").
--
-- Context: the email test-send bug fix (fix(d2c/test-send)) pivots "Send test
-- to me" from cloning an already-fired Mailchimp campaign (which doesn't exist
-- for any not-yet-fired send) to creating a FRESH campaign at test time, via
-- the same ephemeral member-of-1 static segment pattern the webhook
-- autoresponder uses (migration 142 / lib/d2c/autoresp). Test fires reuse the
-- `d2c_autoresp_fires` claim/finalize/release plumbing for audit — but a test
-- fire must NEVER dedup-lock a real fire (or vice versa): clicking "test" on
-- Throwback Algarve's announce send must not prevent the real announce send
-- to that same member later, and repeat test clicks must not be blocked by
-- the (event, provider, member) dedup lock migration 142 introduced.
--
-- This migration adds `is_test` and re-scopes the dedup unique index to real
-- (non-test) fires only via a partial index. Test rows get NO dedup
-- constraint — every "Send test to me" click is an intentional fresh fire.
--
-- Apply manually post-merge via the Supabase MCP `apply_migration` (same flow
-- as migrations 142 / 143).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.d2c_autoresp_fires
  add column if not exists is_test boolean not null default false;

comment on column public.d2c_autoresp_fires.is_test is
  'true for an operator "Send test to me" fire (any job_type, not just autoresp_setup). Audited here but excluded from the dedup unique index (partial, WHERE is_test = false) and from every AutorespFireSummary aggregate (lib/db/d2c-autoresp.ts), so testing a send never blocks or pollutes real per-member autoresponder fires. Migration 144.';

-- Re-scope the dedup lock to real fires only. A plain unique index would
-- block a second test click (or a real fire after a test click) on the same
-- (event, provider, member) — a partial index conditioned on is_test = false
-- excludes every test row from the uniqueness check entirely.
drop index if exists public.d2c_autoresp_fires_dedup_idx;
create unique index if not exists d2c_autoresp_fires_dedup_idx
  on public.d2c_autoresp_fires (event_id, provider, member_identifier)
  where is_test = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_count int;
  v_indexdef text;
begin
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'd2c_autoresp_fires'
    and column_name = 'is_test';
  if v_count <> 1 then
    raise exception 'migration 144 verification: is_test column missing';
  end if;

  select indexdef into v_indexdef
  from pg_indexes
  where schemaname = 'public' and tablename = 'd2c_autoresp_fires'
    and indexname = 'd2c_autoresp_fires_dedup_idx';
  if v_indexdef is null then
    raise exception 'migration 144 verification: dedup unique index missing';
  end if;
  if v_indexdef not ilike '%is_test = false%' and v_indexdef not ilike '%(is_test = false)%' then
    raise exception 'migration 144 verification: dedup unique index is not scoped to is_test = false (got: %)', v_indexdef;
  end if;

  raise notice 'migration 144 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
