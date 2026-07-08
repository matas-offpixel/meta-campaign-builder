-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 142 — d2c_autoresp_fires (per-member autoresponder fire audit +
-- dedup lock).
--
-- Context: PR #696 shipped the `autoresp_setup` job as a one-off broadcast fired
-- at approve-time to whoever held the signup tag right then — future signups got
-- no autoresponder. This migration underpins the webhook/poll-driven rewrite:
-- the autoresponder is "armed" at approve-time (config stored on
-- d2c_scheduled_sends.result_jsonb.autoresp_config, no schema change there — it's
-- jsonb), and every qualifying tag-add / list-add fires a single-recipient send
-- recorded here.
--
-- This table is BOTH the audit log AND the dedup lock:
--   * The unique index on (event_id, provider, member_identifier) guarantees a
--     member is never autoresponded twice for the same event on the same
--     channel. The fire path CLAIMS the row (insert) before sending, so two
--     concurrent webhooks for the same member can't both fire.
--   * dry_run rows are recorded too (when the 3-of-3 live gate is off): the
--     audit shows the intent and still dedups, matching the spec.
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: guarded with IF NOT EXISTS / drop-then-create on policies.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.d2c_autoresp_fires (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  send_id uuid not null references public.d2c_scheduled_sends (id) on delete cascade,
  provider text not null check (provider in ('mailchimp', 'bird')),
  -- email for mailchimp, phone E.164 for bird
  member_identifier text not null,
  fired_at timestamptz not null default now(),
  dry_run boolean not null default true,
  provider_response_jsonb jsonb,
  error text
);

comment on table public.d2c_autoresp_fires is
  'Per-member autoresponder fire audit + dedup lock. Unique on (event_id, provider, member_identifier) so a member is autoresponded at most once per event per channel. Written service-role only from the webhook/poll/backfill fire paths. Migration 142.';

-- Dedup: never fire twice for the same (event, provider, member).
create unique index if not exists d2c_autoresp_fires_dedup_idx
  on public.d2c_autoresp_fires (event_id, provider, member_identifier);

-- Dashboard fire-log lookups (recent fires for a send).
create index if not exists d2c_autoresp_fires_send_idx
  on public.d2c_autoresp_fires (send_id, fired_at desc);

alter table public.d2c_autoresp_fires enable row level security;

-- Owner read: the operator who owns the event can read its fire log via a
-- direct PostgREST call. Writes are service-role only (the webhook/poll/backfill
-- paths use the service-role client, which bypasses RLS) — there is deliberately
-- NO insert/update/delete policy.
drop policy if exists "d2c autoresp fires owner read" on public.d2c_autoresp_fires;
create policy "d2c autoresp fires owner read"
  on public.d2c_autoresp_fires
  for select
  using (
    exists (
      select 1
      from public.events e
      where e.id = d2c_autoresp_fires.event_id
        and e.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from information_schema.tables
  where table_schema = 'public' and table_name = 'd2c_autoresp_fires';
  if v_count <> 1 then
    raise exception 'migration 142 verification: d2c_autoresp_fires table missing';
  end if;

  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public' and tablename = 'd2c_autoresp_fires'
    and indexname = 'd2c_autoresp_fires_dedup_idx';
  if v_count <> 1 then
    raise exception 'migration 142 verification: dedup unique index missing';
  end if;

  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public' and tablename = 'd2c_autoresp_fires'
    and indexname = 'd2c_autoresp_fires_send_idx';
  if v_count <> 1 then
    raise exception 'migration 142 verification: send index missing';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'd2c_autoresp_fires'
    and policyname = 'd2c autoresp fires owner read';
  if v_count <> 1 then
    raise exception 'migration 142 verification: owner read RLS policy missing';
  end if;

  raise notice 'migration 142 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
