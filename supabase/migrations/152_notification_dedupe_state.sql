-- Task #121 Phase 1 — reusable Slack notification service.
--
-- One row per "thing we might notify about repeatedly" — keyed by a
-- caller-chosen `dedupe_key` (e.g. `budget_threshold:<campaignId>:<threshold>`).
-- `lib/notify/slack.ts`'s `notify()` reads/writes this table to decide
-- whether a given alert should fire again, and to give the operator a
-- "mute this alert" lever (the `muted` flag) without touching the calling
-- cron's code. The click-through UI to flip `muted` ships in a later phase;
-- this migration only lays the column down.
--
-- NOTE: numbered 152, not 151 — migration 151
-- (`campaign_automation_decisions`, task #120 PR A) was claimed by a
-- sibling branch (`cursor/optimisation-automation-phase-a`) still open at
-- the time this branch was cut off the same `main`. Picked the next free
-- number deliberately to avoid a guaranteed collision on merge.

create table if not exists notification_dedupe_state (
  dedupe_key text primary key,
  last_fired_at timestamptz not null default now(),
  fire_count integer not null default 1,
  muted boolean not null default false,
  muted_at timestamptz,
  data jsonb
);

create index if not exists idx_ndas_last_fired on notification_dedupe_state (last_fired_at desc);

-- ── RLS — authenticated read, service-role write ─────────────────────────
-- Same posture as migration 151 (campaign_automation_decisions): operator
-- audit data, not per-user scoped. Only the service-role `notify()` caller
-- (bypasses RLS) upserts — no write policy defined on purpose. A later
-- phase's "mute this alert" click-through will need its own authenticated
-- write policy scoped to `muted`/`muted_at`; deliberately not added yet.
alter table notification_dedupe_state enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_dedupe_state'
      and policyname = 'authenticated read notification dedupe state'
  ) then
    execute
      'create policy "authenticated read notification dedupe state" '
      'on notification_dedupe_state for select '
      'to authenticated using (true)';
  end if;
end $$;

comment on table notification_dedupe_state is
  'Task #121 Phase 1 — per-alert dedupe/mute state for lib/notify/slack.ts. dedupe_key is caller-defined (e.g. budget_threshold:<campaignId>:<threshold>); data holds the last fired payload for debugging. Migration 152.';

notify pgrst, 'reload schema';
