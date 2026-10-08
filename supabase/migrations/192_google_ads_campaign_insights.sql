-- Migration 192 — Google Ads campaign grain, search terms, locations
--
-- Campaign-grain, search-term and user-location facts per day for every
-- campaign on a client Google Ads account. Written by
-- /api/cron/google-ads-daily-insights (service role), which restates the
-- last three complete days nightly. Read-only against Google Ads.
--
-- The event grain stays where it is (event_daily_rollups.google_ads_*,
-- written by rollup-sync). These tables do not replace it.
--
-- google_ads_insights_runs is one row per cron run so cron-health can
-- show a run that reported a failed account, not only a stale table.
-- google_ads_accounts.enabled_conversion_actions drives the "running
-- blind" plan badge.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent: if not exists + catalog-checked policies.

create table if not exists google_ads_daily_snapshots (
  id                           uuid primary key default gen_random_uuid(),
  user_id                      uuid not null,
  google_ads_account_id        uuid not null references google_ads_accounts(id) on delete cascade,
  customer_id                  text not null,
  plan_id                      uuid null,
  plan_kind                    text null check (plan_kind in ('search', 'video')),
  campaign_resource_name       text not null,
  campaign_name                text,
  advertising_channel_type     text,
  event_code                   text null,
  date                         date not null,
  impressions                  bigint not null default 0,
  clicks                       bigint not null default 0,
  cost_micros                  bigint not null default 0,
  conversions                  numeric not null default 0,
  conversion_value_micros      bigint not null default 0,
  video_trueview_views         bigint null,
  video_trueview_view_rate     numeric null,
  trueview_average_cpv_micros  bigint null,
  search_impression_share      numeric null,
  fetched_at                   timestamptz not null default now(),
  constraint google_ads_daily_snapshots_campaign_date_key unique (campaign_resource_name, date)
);

create index if not exists google_ads_daily_snapshots_account_date_idx
  on google_ads_daily_snapshots (google_ads_account_id, date);

create index if not exists google_ads_daily_snapshots_plan_date_idx
  on google_ads_daily_snapshots (plan_id, date);

create index if not exists google_ads_daily_snapshots_event_code_date_idx
  on google_ads_daily_snapshots (event_code, date);

comment on table google_ads_daily_snapshots is
  'Google Ads metrics per campaign per day, every campaign on a client account (SEARCH, VIDEO and any other channel). Last 3 days restated nightly. Migration 192.';
comment on column google_ads_daily_snapshots.customer_id is
  'Digits only, as in campaign_resource_name (customers/{customer_id}/campaigns/{id}).';
comment on column google_ads_daily_snapshots.plan_id is
  'google_search_plans.id when campaign_resource_name = google_search_campaigns.pushed_resource_name (plan_kind search), google_video_plans.id when it = google_video_campaigns.google_campaign_resource_name (plan_kind video).';
comment on column google_ads_daily_snapshots.event_code is
  'The first [CODE] in the campaign name, exactly as written: never uppercased or normalised. Null when the name has no brackets.';
comment on column google_ads_daily_snapshots.conversion_value_micros is
  'metrics.conversions_value (account currency) × 1,000,000.';
comment on column google_ads_daily_snapshots.video_trueview_views is
  'VIDEO campaigns only; null for other channel types.';
comment on column google_ads_daily_snapshots.trueview_average_cpv_micros is
  'metrics.trueview_average_cpv, which Google reports in micros. VIDEO only.';
comment on column google_ads_daily_snapshots.search_impression_share is
  'metrics.search_impression_share, 0–1 (Google reports under 10% as 0.0999). SEARCH only.';

create table if not exists google_ads_search_terms_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null,
  customer_id             text not null,
  plan_id                 uuid null,
  campaign_resource_name  text not null,
  ad_group_resource_name  text not null,
  date                    date not null,
  search_term             text not null,
  match_type              text not null,
  clicks                  bigint not null default 0,
  impressions             bigint not null default 0,
  cost_micros             bigint not null default 0,
  conversions             numeric not null default 0,
  fetched_at              timestamptz not null default now(),
  constraint google_ads_search_terms_snapshots_key
    unique (campaign_resource_name, ad_group_resource_name, date, search_term, match_type)
);

create index if not exists google_ads_search_terms_snapshots_customer_date_idx
  on google_ads_search_terms_snapshots (customer_id, date);

create index if not exists google_ads_search_terms_snapshots_plan_date_idx
  on google_ads_search_terms_snapshots (plan_id, date);

comment on table google_ads_search_terms_snapshots is
  'search_term_view per ad group per day. match_type is segments.search_term_match_type (EXACT, PHRASE, BROAD, NEAR_EXACT, NEAR_PHRASE). Migration 192.';

create table if not exists google_ads_location_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null,
  customer_id             text not null,
  campaign_resource_name  text not null,
  date                    date not null,
  country_criterion_id    bigint not null,
  location_type           text not null,
  clicks                  bigint not null default 0,
  impressions             bigint not null default 0,
  cost_micros             bigint not null default 0,
  fetched_at              timestamptz not null default now(),
  constraint google_ads_location_snapshots_key
    unique (campaign_resource_name, date, country_criterion_id, location_type)
);

create index if not exists google_ads_location_snapshots_customer_date_idx
  on google_ads_location_snapshots (customer_id, date);

comment on table google_ads_location_snapshots is
  'geographic_view per campaign per day: where the people who saw the ads were. country_criterion_id is a geoTargetConstants id (2826 = United Kingdom). location_type is LOCATION_OF_PRESENCE or AREA_OF_INTEREST. Migration 192.';

create table if not exists google_ads_insights_runs (
  id               uuid primary key default gen_random_uuid(),
  run_at           timestamptz not null default now(),
  since            date not null,
  until            date not null,
  ok               boolean not null,
  accounts         integer not null default 0,
  calls            integer not null default 0,
  rows_written     integer not null default 0,
  failed_accounts  jsonb not null default '[]'::jsonb,
  outcomes         jsonb not null default '[]'::jsonb
);

create index if not exists google_ads_insights_runs_run_at_idx
  on google_ads_insights_runs (run_at desc);

comment on table google_ads_insights_runs is
  'One row per /api/cron/google-ads-daily-insights run. ok is false when any account failed, including an account whose event rollup shows Google spend on a day with no campaign rows. cron-health reads the latest row. Migration 192.';

alter table google_ads_accounts
  add column if not exists enabled_conversion_actions integer null,
  add column if not exists conversion_actions_checked_at timestamptz null;

comment on column google_ads_accounts.enabled_conversion_actions is
  'ENABLED conversion_action rows on the account, excluding GOOGLE_HOSTED (Google''s own local actions). 0 = the plan badge says running blind. Null = not checked yet. Written by the google-ads-daily-insights cron.';

alter table google_ads_daily_snapshots enable row level security;
alter table google_ads_search_terms_snapshots enable row level security;
alter table google_ads_location_snapshots enable row level security;
alter table google_ads_insights_runs enable row level security;

do $$
declare
  t text;
begin
  -- Writes are service-role only (no insert/update policy). Reads: the
  -- operator who owns the Google Ads account (user_id is copied from
  -- google_ads_accounts.user_id). client_users never match. The run log
  -- has no policy: service role only.
  foreach t in array array[
    'google_ads_daily_snapshots',
    'google_ads_search_terms_snapshots',
    'google_ads_location_snapshots'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = 'authenticated read own ' || t
    ) then
      execute format(
        'create policy %I on %I for select to authenticated using (user_id = auth.uid())',
        'authenticated read own ' || t,
        t
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
