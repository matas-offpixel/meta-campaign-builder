-- Migration 096 — Google Search Campaign Creator wizard data model.
--
-- Phase 1 of the Google Search wizard build
-- (docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md). Phase 0
-- (write API spike, PR #442) proved the mutate path on Basic Access;
-- this migration introduces the relational tables that back the wizard
-- + the xlsx-import path.
--
-- Shape (one tree per plan):
--   google_search_plans          1
--     ├ google_search_campaigns  N
--     │   ├ google_search_ad_groups   N
--     │   │   ├ google_search_keywords N
--     │   │   └ google_search_rsas     N
--     │   └ google_search_negatives (campaign-scoped)  N
--     └ google_search_negatives (plan-scoped)          N
--
-- RLS: every table is per-user. The top-level plan checks
-- `auth.uid() = user_id`; child tables join up to the plan owner using
-- the same `IN (SELECT ... WHERE user_id = auth.uid())` pattern as
-- migration 077 (tier_channel_allocations). `for all` collapses
-- select/insert/update/delete into one policy per table.
--
-- service_role bypasses everywhere so Phase 3 push adapter + future
-- cron jobs can operate without a forged session.
--
-- Apply manually via Supabase MCP after PR review. No backfill.

create table if not exists google_search_plans (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  event_id              uuid references events(id) on delete set null,
  google_ads_account_id uuid references google_ads_accounts(id) on delete set null,
  name                  text not null,
  status                text not null default 'draft'
    check (status in ('draft','pushed','partially_pushed','archived')),
  total_budget          numeric(12,2),
  bidding_strategy      text not null default 'maximize_clicks'
    check (bidding_strategy in ('maximize_clicks','manual_cpc')),
  geo_targets           jsonb not null default '[]'::jsonb,
  date_range            jsonb,
  pushed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table google_search_plans is
  'Top-level Google Search Campaign Creator plan. Children are normalised in google_search_campaigns / ad_groups / keywords / negatives / rsas.';
comment on column google_search_plans.status is
  'draft = wizard editing; pushed = launch succeeded; partially_pushed = Phase 3 partial-failure state (mirrors Meta launch contract); archived = soft-hidden.';
comment on column google_search_plans.geo_targets is
  'JSON array of {location: text, bid_modifier_pct: numeric}. Bid modifiers attach via campaignCriterion.bid_modifier at push time (Phase 3).';
comment on column google_search_plans.date_range is
  'JSON {since: ISO date, until: ISO date}. Optional — null means the plan runs indefinitely under the campaign default schedule.';

create index if not exists google_search_plans_user_updated_idx
  on google_search_plans (user_id, updated_at desc);
create index if not exists google_search_plans_event_idx
  on google_search_plans (event_id);

create table if not exists google_search_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               uuid not null references google_search_plans(id) on delete cascade,
  name                  text not null,
  priority              text,
  monthly_budget        numeric(12,2),
  daily_budget          numeric(12,2),
  bid_adjustments       jsonb not null default '{}'::jsonb,
  notes                 text,
  sort_order            integer not null default 0,
  pushed_resource_name  text,
  created_at            timestamptz not null default now()
);

comment on column google_search_campaigns.name is
  'Wizard-editable campaign name. The push adapter (Phase 3) auto-prefixes [event_code] so the reporting matcher scopes the campaign to its event.';
comment on column google_search_campaigns.bid_adjustments is
  'JSON {device?: {...}, schedule?: [...], geo?: [...]} — campaign-level bid modifiers staged for push. Schema is intentionally loose to match the Google Ads campaignCriterion shape (Phase 3 normalises).';

create index if not exists google_search_campaigns_plan_idx
  on google_search_campaigns (plan_id);

create table if not exists google_search_ad_groups (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references google_search_campaigns(id) on delete cascade,
  name                  text not null,
  default_cpc           numeric(8,2),
  sort_order            integer not null default 0,
  pushed_resource_name  text,
  created_at            timestamptz not null default now()
);

create index if not exists google_search_ad_groups_campaign_idx
  on google_search_ad_groups (campaign_id);

create table if not exists google_search_keywords (
  id                    uuid primary key default gen_random_uuid(),
  ad_group_id           uuid not null references google_search_ad_groups(id) on delete cascade,
  keyword               text not null,
  match_type            text not null check (match_type in ('EXACT','PHRASE','BROAD')),
  est_cpc_low           numeric(8,2),
  est_cpc_high          numeric(8,2),
  intent                text,
  notes                 text,
  pushed_resource_name  text,
  created_at            timestamptz not null default now()
);

comment on column google_search_keywords.intent is
  'Free-text intent tag (e.g. Brand / Transactional / Discovery). Drives wizard colour-coding; not pushed to Google.';

create index if not exists google_search_keywords_ad_group_idx
  on google_search_keywords (ad_group_id);

create table if not exists google_search_negatives (
  id                    uuid primary key default gen_random_uuid(),
  plan_id               uuid not null references google_search_plans(id) on delete cascade,
  campaign_id           uuid references google_search_campaigns(id) on delete cascade,
  keyword               text not null,
  match_type            text not null check (match_type in ('EXACT','PHRASE','BROAD')),
  reason                text,
  pushed_resource_name  text,
  created_at            timestamptz not null default now()
);

comment on table google_search_negatives is
  'Plan-scoped negatives when campaign_id is null (Phase 3 creates a shared negative keyword list); campaign-scoped negatives otherwise (Phase 3 attaches as adGroupCriterion negative=true).';

create index if not exists google_search_negatives_plan_idx
  on google_search_negatives (plan_id);
create index if not exists google_search_negatives_campaign_idx
  on google_search_negatives (campaign_id);

create table if not exists google_search_rsas (
  id                    uuid primary key default gen_random_uuid(),
  ad_group_id           uuid not null references google_search_ad_groups(id) on delete cascade,
  headlines             jsonb not null default '[]'::jsonb,
  descriptions          jsonb not null default '[]'::jsonb,
  final_url             text,
  path1                 text,
  path2                 text,
  pushed_resource_name  text,
  created_at            timestamptz not null default now()
);

comment on column google_search_rsas.headlines is
  'JSON array of {text: string, pin_position?: 1|2|3}. Google Ads caps headlines at 30 chars; wizard validates pre-push, parser flags overflow.';
comment on column google_search_rsas.descriptions is
  'JSON array of {text: string, pin_position?: 1|2}. Google Ads caps descriptions at 90 chars.';

create index if not exists google_search_rsas_ad_group_idx
  on google_search_rsas (ad_group_id);

-- ─── updated_at trigger (top-level plan only) ──────────────────────────
create or replace function set_google_search_plans_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.google_search_plans'::regclass
      and tgname = 'google_search_plans_updated_at'
  ) then
    execute
      'create trigger google_search_plans_updated_at '
      'before update on google_search_plans '
      'for each row execute function set_google_search_plans_updated_at()';
  end if;
end $$;

-- ─── RLS ──────────────────────────────────────────────────────────────
alter table google_search_plans      enable row level security;
alter table google_search_campaigns  enable row level security;
alter table google_search_ad_groups  enable row level security;
alter table google_search_keywords   enable row level security;
alter table google_search_negatives  enable row level security;
alter table google_search_rsas       enable row level security;

drop policy if exists google_search_plans_owner on google_search_plans;
create policy google_search_plans_owner on google_search_plans
  for all
  using (auth.role() = 'service_role' or auth.uid() = user_id)
  with check (auth.role() = 'service_role' or auth.uid() = user_id);

drop policy if exists google_search_campaigns_owner on google_search_campaigns;
create policy google_search_campaigns_owner on google_search_campaigns
  for all
  using (
    auth.role() = 'service_role'
    or plan_id in (select id from google_search_plans where user_id = auth.uid())
  )
  with check (
    auth.role() = 'service_role'
    or plan_id in (select id from google_search_plans where user_id = auth.uid())
  );

drop policy if exists google_search_ad_groups_owner on google_search_ad_groups;
create policy google_search_ad_groups_owner on google_search_ad_groups
  for all
  using (
    auth.role() = 'service_role'
    or campaign_id in (
      select c.id from google_search_campaigns c
      join google_search_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or campaign_id in (
      select c.id from google_search_campaigns c
      join google_search_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  );

drop policy if exists google_search_keywords_owner on google_search_keywords;
create policy google_search_keywords_owner on google_search_keywords
  for all
  using (
    auth.role() = 'service_role'
    or ad_group_id in (
      select ag.id from google_search_ad_groups ag
      join google_search_campaigns c on c.id = ag.campaign_id
      join google_search_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or ad_group_id in (
      select ag.id from google_search_ad_groups ag
      join google_search_campaigns c on c.id = ag.campaign_id
      join google_search_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  );

drop policy if exists google_search_negatives_owner on google_search_negatives;
create policy google_search_negatives_owner on google_search_negatives
  for all
  using (
    auth.role() = 'service_role'
    or plan_id in (select id from google_search_plans where user_id = auth.uid())
  )
  with check (
    auth.role() = 'service_role'
    or plan_id in (select id from google_search_plans where user_id = auth.uid())
  );

drop policy if exists google_search_rsas_owner on google_search_rsas;
create policy google_search_rsas_owner on google_search_rsas
  for all
  using (
    auth.role() = 'service_role'
    or ad_group_id in (
      select ag.id from google_search_ad_groups ag
      join google_search_campaigns c on c.id = ag.campaign_id
      join google_search_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  )
  with check (
    auth.role() = 'service_role'
    or ad_group_id in (
      select ag.id from google_search_ad_groups ag
      join google_search_campaigns c on c.id = ag.campaign_id
      join google_search_plans p on p.id = c.plan_id
      where p.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
