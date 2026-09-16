-- Migration 178 — campaign_daily_insights (Armed tab floor 4 store)
--
-- Campaign-grain daily Meta insights. One row per (meta_campaign_id, date).
-- The fetch already exists in lib/insights/meta.ts (level=campaign,
-- time_increment=1). This table is the store the Armed 14-day trend
-- reads from. event_daily_rollups is event-grain; creative_insight_snapshots
-- is ad-level on rolling presets. Neither can draw floor 4.
--
-- results is the resolved primary result for the draft's objective (the
-- Armed row's denominator), not every action type. Floor 4 is one series
-- and it must be the same count the chip is a cost of. A day Meta reports
-- nothing is absent — never a zero row — so the series can draw a gap.
--
-- Written by rollup-sync-events (the tick that already pays for this Graph
-- shape). Upsert on (meta_campaign_id, date) so yesterday is corrected when
-- Meta revises it.
--
-- Apply by hand: prod first, then CI, only when the PR is about to merge.
-- Do not apply in this run. Idempotent: if not exists throughout.

create table if not exists campaign_daily_insights (
  id                 uuid primary key default gen_random_uuid(),
  meta_campaign_id   text not null,
  date               date not null,
  ad_account_id      text,
  draft_id           uuid references campaign_drafts(id) on delete set null,
  channel            text not null default 'meta',
  spend              numeric,
  impressions        bigint,
  reach              bigint,
  clicks             bigint,
  link_clicks        bigint,
  results            numeric,
  result_action_type text,
  fetched_at         timestamptz not null default now(),
  unique (meta_campaign_id, date)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'campaign_daily_insights_channel_check'
  ) then
    alter table campaign_daily_insights
      add constraint campaign_daily_insights_channel_check
      check (channel in ('meta', 'tiktok', 'google'));
  end if;
end $$;

create index if not exists idx_campaign_daily_insights_draft_date
  on campaign_daily_insights (draft_id, date desc);

alter table campaign_daily_insights enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'campaign_daily_insights'
      and policyname = 'authenticated read campaign daily insights'
  ) then
    execute
      'create policy "authenticated read campaign daily insights" '
      'on campaign_daily_insights for select '
      'to authenticated using (true)';
  end if;
end $$;

comment on table campaign_daily_insights is
  'Campaign-grain daily Meta insights for the Armed tab 14-day trend (floor 4). One row per (meta_campaign_id, date). Absent day = gap, never a padded zero. results is the objective''s primary action count. Migration 178 — unapplied.';
comment on column campaign_daily_insights.results is
  'Resolved primary result count for the draft objective (same candidate list as live-metric.ts). Null when the primary metric has no countable action (cpm/cpc/ctr) or Meta omitted it.';
comment on column campaign_daily_insights.channel is
  'meta until a later grain. Default meta so a re-run without the column filled is still the Armed store.';

notify pgrst, 'reload schema';
