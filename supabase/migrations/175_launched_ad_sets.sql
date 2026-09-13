-- Migration 175 — launched_ad_sets (self-learning Phase 0)
--
-- The only record of which Meta ad set was which audience is
-- launchSummary.adSetLaunchResults — a JSON blob keyed on a client
-- UUID, overwritten on every relaunch, absent for ad sets created
-- through paths that never wrote a summary. Performance is keyed on
-- meta_adset_id. They cannot be joined.
--
-- One row per Meta ad set this app creates. The descriptor is a
-- snapshot, not a reference — the draft will be edited later.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent: if not exists + catalog-checked indexes.

create table if not exists launched_ad_sets (
  id                        uuid primary key default gen_random_uuid(),
  meta_adset_id             text not null unique,
  meta_campaign_id          text,
  ad_account_id             text,
  draft_id                  uuid references campaign_drafts(id) on delete set null,
  user_id                   uuid,
  client_id                 uuid references clients(id) on delete set null,
  event_id                  uuid references events(id) on delete set null,
  launched_at               timestamptz not null default now(),
  launch_run_id             uuid not null,
  channel                   text not null default 'meta',
  source_type               text,
  source_id                 text,
  source_name               text,
  age_min                   integer,
  age_max                   integer,
  lookalike_range           text,
  geo                       jsonb,
  advantage_plus            boolean,
  interest_ids              jsonb,
  objective                 text,
  phase_at_launch           text,
  initial_daily_budget_pence integer,
  suggestion_id             text,
  descriptor_source         text not null default 'launch',
  created_at                timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'launched_ad_sets_channel_check'
  ) then
    alter table launched_ad_sets
      add constraint launched_ad_sets_channel_check
      check (channel in ('meta', 'tiktok', 'google'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'launched_ad_sets_descriptor_source_check'
  ) then
    alter table launched_ad_sets
      add constraint launched_ad_sets_descriptor_source_check
      check (descriptor_source in ('launch', 'backfill_from_launch_summary'));
  end if;
end $$;

create index if not exists launched_ad_sets_draft_id_idx
  on launched_ad_sets (draft_id);

create index if not exists launched_ad_sets_event_id_idx
  on launched_ad_sets (event_id);

create index if not exists launched_ad_sets_client_source_idx
  on launched_ad_sets (client_id, source_type);

comment on table launched_ad_sets is
  'Phase 0 join: one row per Meta (and later TikTok/Google) ad set this app creates. Descriptor is a launch-time snapshot. meta_adset_id is the join to performance. Migration 175.';

alter table launched_ad_sets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'launched_ad_sets'
      and policyname = 'authenticated read launched_ad_sets'
  ) then
    execute
      'create policy "authenticated read launched_ad_sets" '
      'on launched_ad_sets for select '
      'to authenticated using (true)';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'launched_ad_sets'
      and policyname = 'authenticated insert own launched_ad_sets'
  ) then
    execute
      'create policy "authenticated insert own launched_ad_sets" '
      'on launched_ad_sets for insert '
      'to authenticated with check (user_id = auth.uid())';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'launched_ad_sets'
      and policyname = 'authenticated update own launched_ad_sets'
  ) then
    execute
      'create policy "authenticated update own launched_ad_sets" '
      'on launched_ad_sets for update '
      'to authenticated using (user_id = auth.uid())';
  end if;
end $$;

notify pgrst, 'reload schema';
