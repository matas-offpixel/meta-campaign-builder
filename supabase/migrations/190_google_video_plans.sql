-- Migration 190 — YouTube video plans (Google Ads Editor export).
--
-- The Google Ads API cannot create or change Video campaigns
-- (https://developers.google.com/google-ads/api/docs/video/overview).
-- A video plan is imported from a build sheet, checked, and downloaded as
-- a Google Ads Editor CSV. Nothing here is pushed to Google, so there is
-- no pushed_at and no pushed_resource_name. exported_at records the
-- download. google_campaign_resource_name is filled in by hand once the
-- campaign is live, for reporting.
--
--   google_video_plans          1
--     ├ google_video_campaigns  N
--     │   └ google_video_ad_groups   N
--     │       └ google_video_placements N
--     └ google_video_ads        N  (every ad runs in every ad group)
--
-- RLS: owner-only, the same pattern as google_search_plans (migration
-- 096). Child tables join up to the plan's user_id.
--
-- Matas applies. No backfill.

create table if not exists google_video_plans (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  event_id               uuid references events(id) on delete set null,
  google_ads_account_id  uuid references google_ads_accounts(id) on delete set null,
  name                   text not null,
  status                 text not null default 'draft'
    check (status in ('draft','exported','live')),
  daily_budget           numeric(12,2),
  total_budget           numeric(12,2),
  start_date             date,
  end_date               date,
  cpv_bid                numeric(8,2),
  include_video_partners boolean not null default false,
  device_exclusions      text[] not null default '{CONNECTED_TV}',
  frequency_cap_per_day  integer,
  frequency_cap_per_week integer,
  language_codes         text[] not null default '{}',
  geo_targets            jsonb not null default '[]'::jsonb,
  final_url              text,
  display_url            text,
  call_to_action         text,
  settings_rows          jsonb not null default '[]'::jsonb,
  targeting_rows         jsonb not null default '[]'::jsonb,
  source_filename        text,
  exported_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table google_video_plans is
  'YouTube video plan. Exported as a Google Ads Editor CSV; the Google Ads API cannot create Video campaigns.';
comment on column google_video_plans.status is
  'draft = editing; exported = Editor CSV downloaded (exported_at); live = operator marked it posted from Editor.';
comment on column google_video_plans.daily_budget is
  'Per campaign. Null = total_budget / inclusive days from start_date to end_date.';
comment on column google_video_plans.device_exclusions is
  'CONNECTED_TV excluded unless the operator opts in. Exported as a TV screen bid modifier of -100%.';
comment on column google_video_plans.frequency_cap_per_day is
  'Stored for the Review step. The Editor CSV doc lists no frequency cap column, so it is set by hand in Editor.';
comment on column google_video_plans.geo_targets is
  'JSON array of {name, bid_modifier_pct, negative}.';
comment on column google_video_plans.settings_rows is
  'Campaign Settings rows as written on the sheet ({setting, value, note}). Review lists the ones the CSV cannot carry.';
comment on column google_video_plans.targeting_rows is
  'Targeting & Exclusions rows as written on the sheet ({type, setting, value, note}).';

create index if not exists google_video_plans_user_updated_idx
  on google_video_plans (user_id, updated_at desc);
create index if not exists google_video_plans_event_idx
  on google_video_plans (event_id);

create table if not exists google_video_campaigns (
  id                             uuid primary key default gen_random_uuid(),
  plan_id                        uuid not null references google_video_plans(id) on delete cascade,
  name                           text not null,
  tier                           text,
  status                         text not null default 'enabled'
    check (status in ('enabled','paused')),
  daily_budget                   numeric(12,2),
  google_campaign_resource_name  text null,
  sort_order                     integer not null default 0,
  created_at                     timestamptz not null default now()
);

comment on column google_video_campaigns.name is
  'Exactly as written on the sheet. The [IRW0004] prefix scopes the campaign to its event in reporting and is case-sensitive.';
comment on column google_video_campaigns.daily_budget is
  'Override. Null = the plan daily budget.';

create index if not exists google_video_campaigns_plan_idx
  on google_video_campaigns (plan_id);

create table if not exists google_video_ad_groups (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references google_video_campaigns(id) on delete cascade,
  name         text not null,
  status       text not null default 'enabled'
    check (status in ('enabled','paused')),
  cpv_bid      numeric(8,2),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on column google_video_ad_groups.cpv_bid is
  'Override. Null = the plan CPV bid.';

create index if not exists google_video_ad_groups_campaign_idx
  on google_video_ad_groups (campaign_id);

create table if not exists google_video_placements (
  id           uuid primary key default gen_random_uuid(),
  ad_group_id  uuid not null references google_video_ad_groups(id) on delete cascade,
  label        text not null,
  value        text not null default '',
  kind         text check (kind in ('video','channel','handle')),
  resolved_id  text,
  status       text not null default 'enabled'
    check (status in ('enabled','paused')),
  note         text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on column google_video_placements.value is
  'As written on the sheet (a URL, or an instruction such as "Add 5-10 set uploads").';
comment on column google_video_placements.resolved_id is
  'Video id, UC channel id, or @handle parsed from value. Null = not a YouTube link.';

create index if not exists google_video_placements_ad_group_idx
  on google_video_placements (ad_group_id);

create table if not exists google_video_ads (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references google_video_plans(id) on delete cascade,
  name            text not null,
  status          text not null default 'enabled'
    check (status in ('enabled','paused')),
  video_value     text,
  video_id        text,
  final_url       text,
  call_to_action  text,
  headline        text,
  long_headline   text,
  description     text,
  note            text,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

comment on table google_video_ads is
  'Plan-level: each ad is exported into every ad group. Limits: CTA 10, headline 15, long headline 90, description 70.';
comment on column google_video_ads.video_value is
  'As written on the sheet (a link or a video title).';

create index if not exists google_video_ads_plan_idx
  on google_video_ads (plan_id);

-- ─── updated_at trigger (top-level plan only) ──────────────────────────
create or replace function set_google_video_plans_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists google_video_plans_updated_at on google_video_plans;
create trigger google_video_plans_updated_at
  before update on google_video_plans
  for each row execute function set_google_video_plans_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────
alter table google_video_plans      enable row level security;
alter table google_video_campaigns  enable row level security;
alter table google_video_ad_groups  enable row level security;
alter table google_video_placements enable row level security;
alter table google_video_ads        enable row level security;

drop policy if exists google_video_plans_owner on google_video_plans;
create policy google_video_plans_owner on google_video_plans
  for all
  using (auth.role() = 'service_role' or auth.uid() = user_id)
  with check (auth.role() = 'service_role' or auth.uid() = user_id);

drop policy if exists google_video_campaigns_owner on google_video_campaigns;
create policy google_video_campaigns_owner on google_video_campaigns
  for all
  using (
    auth.role() = 'service_role'
    or plan_id in (select id from google_video_plans where user_id = auth.uid())
  )
  with check (
    auth.role() = 'service_role'
    or plan_id in (select id from google_video_plans where user_id = auth.uid())
  );

drop policy if exists google_video_ad_groups_owner on google_video_ad_groups;
create policy google_video_ad_groups_owner on google_video_ad_groups
  for all
  using (
    auth.role() = 'service_role'
    or campaign_id in (
      select c.id from google_video_campaigns c
      join google_video_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or campaign_id in (
      select c.id from google_video_campaigns c
      join google_video_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  );

drop policy if exists google_video_placements_owner on google_video_placements;
create policy google_video_placements_owner on google_video_placements
  for all
  using (
    auth.role() = 'service_role'
    or ad_group_id in (
      select ag.id from google_video_ad_groups ag
      join google_video_campaigns c on c.id = ag.campaign_id
      join google_video_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or ad_group_id in (
      select ag.id from google_video_ad_groups ag
      join google_video_campaigns c on c.id = ag.campaign_id
      join google_video_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  );

drop policy if exists google_video_ads_owner on google_video_ads;
create policy google_video_ads_owner on google_video_ads
  for all
  using (
    auth.role() = 'service_role'
    or plan_id in (select id from google_video_plans where user_id = auth.uid())
  )
  with check (
    auth.role() = 'service_role'
    or plan_id in (select id from google_video_plans where user_id = auth.uid())
  );
