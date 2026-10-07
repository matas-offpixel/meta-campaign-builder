-- Migration 185 — ad_daily_insights (learning loop A: per-ad facts)
--
-- One row per Meta ad per day for every ad on a client ad account,
-- whether or not this app launched it. Written by
-- /api/cron/ad-daily-insights (service role), which restates the last
-- three days nightly so attribution lag settles. Campaign grain is a SUM
-- over this table; it replaces campaign_daily_insights, which nothing on
-- main writes.
--
-- Names are snapshots: campaign_name is how an ad the app did not launch
-- reaches an event, via the [EVENT_CODE] convention.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent: if not exists + catalog-checked policies.

create table if not exists ad_daily_insights (
  id                    uuid primary key default gen_random_uuid(),
  ad_account_id         text not null,
  meta_ad_id            text not null,
  meta_adset_id         text,
  meta_campaign_id      text,
  date                  date not null,
  ad_name               text,
  adset_name            text,
  campaign_name         text,
  spend                 numeric not null default 0,
  impressions           bigint not null default 0,
  reach                 bigint not null default 0,
  clicks                bigint not null default 0,
  link_clicks           bigint not null default 0,
  landing_page_views    bigint not null default 0,
  video_plays_3s        bigint not null default 0,
  video_plays_15s       bigint not null default 0,
  video_plays_p100      bigint not null default 0,
  registrations         bigint not null default 0,
  leads                 bigint not null default 0,
  purchases             bigint not null default 0,
  actions               jsonb not null default '[]'::jsonb,
  result_action_type    text,
  fetched_at            timestamptz not null default now(),
  constraint ad_daily_insights_ad_date_key unique (meta_ad_id, date)
);

create index if not exists ad_daily_insights_account_date_idx
  on ad_daily_insights (ad_account_id, date);

create index if not exists ad_daily_insights_campaign_date_idx
  on ad_daily_insights (meta_campaign_id, date);

create index if not exists ad_daily_insights_adset_date_idx
  on ad_daily_insights (meta_adset_id, date);

comment on table ad_daily_insights is
  'Learning loop A: Meta insights per ad per day, every ad on a client ad account (level=ad, time_increment=1). Last 3 days restated nightly. Campaign grain = SUM over this table. Migration 185.';
comment on column ad_daily_insights.ad_account_id is
  'act_-prefixed Meta ad account id.';
comment on column ad_daily_insights.registrations is
  'offsite_conversion.fb_pixel_complete_registration, else complete_registration. Never summed (Meta reports both, equal) and never view_content.';
comment on column ad_daily_insights.leads is
  'offsite_conversion.fb_pixel_lead, else lead. Never summed with registrations.';
comment on column ad_daily_insights.purchases is
  'offsite_conversion.fb_pixel_purchase only, same as event_daily_rollups.';
comment on column ad_daily_insights.actions is
  'Raw Meta actions rows for the day, so later jobs can re-derive without refetching.';
comment on column ad_daily_insights.result_action_type is
  'Action type behind the first non-zero of registrations, leads, purchases; null when none.';

alter table ad_daily_insights enable row level security;

do $$
begin
  -- Writes are service-role only (no insert/update policy). Reads: the
  -- operator who owns a client or event on that ad account. Not every
  -- authenticated user — client_users are authenticated and must not
  -- read another client's per-ad spend.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ad_daily_insights'
      and policyname = 'authenticated read own account ad_daily_insights'
  ) then
    execute
      'create policy "authenticated read own account ad_daily_insights" '
      'on ad_daily_insights for select '
      'to authenticated using ('
      '  exists (select 1 from clients c where c.user_id = auth.uid() '
      '    and c.meta_ad_account_id in (ad_daily_insights.ad_account_id, substr(ad_daily_insights.ad_account_id, 5))) '
      '  or exists (select 1 from events e where e.user_id = auth.uid() '
      '    and e.meta_ad_account_id in (ad_daily_insights.ad_account_id, substr(ad_daily_insights.ad_account_id, 5)))'
      ')';
  end if;
end $$;

notify pgrst, 'reload schema';
