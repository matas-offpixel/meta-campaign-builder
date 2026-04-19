-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017 — Google Ads platform scaffold.
--
-- Google Ads (Search) is used to convert warm artist/brand/genre queries
-- into ticket buyers. Reference plan that informed the schema is the J2
-- Melodic plan: 7 campaigns (Brand, 4 artist focused, Genre, RLSA), Max
-- Conversions / Manual CPC mix, +20% London, RLSA boosts, etc.
--
-- Schema:
--   - google_ads_accounts          one row per linked Google Ads customer
--                                  (RLS owner-only, mirrors tiktok_accounts).
--   - google_ad_plans              one row per event-level Search plan,
--                                  with the per-campaign mix stored as
--                                  jsonb so the plan builder can iterate
--                                  shape without DDL churn.
--
-- The campaigns array follows the GoogleAdCampaign shape from
-- lib/types/google-ads.ts (id, name, focus, ad_groups, monthly_budget,
-- priority, bidding_strategy, notes). geo_targets / rlsa_adjustments /
-- ad_scheduling are left as free-form jsonb so the UI can iterate
-- without schema migrations every time a new dimension is added.
--
-- Slice 5 follows up with events.google_ads_account_id +
-- clients.google_ads_account_id FKs to wire the per-event linker UI.
--
-- After applying:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists google_ads_accounts (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users (id) on delete cascade,
  account_name       text        not null,
  google_customer_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint google_ads_accounts_user_account_unique
    unique (user_id, account_name)
);

create index if not exists google_ads_accounts_user_id_idx
  on google_ads_accounts (user_id);

comment on table  google_ads_accounts is
  'Linked Google Ads MCC / customer accounts. One row per customer the owner has connected. google_customer_id is the dashed "123-456-7890" shape from Google.';
comment on column google_ads_accounts.account_name is
  'Friendly label shown in dashboard pickers (e.g. "OffPixel MCC", "Junction 2 direct").';
comment on column google_ads_accounts.google_customer_id is
  'Google Ads customer id in dashed format. Required to make any API call — null until verified.';

alter table google_ads_accounts enable row level security;

drop policy if exists google_ads_accounts_owner_select on google_ads_accounts;
create policy google_ads_accounts_owner_select on google_ads_accounts
  for select using (auth.uid() = user_id);

drop policy if exists google_ads_accounts_owner_insert on google_ads_accounts;
create policy google_ads_accounts_owner_insert on google_ads_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists google_ads_accounts_owner_update on google_ads_accounts;
create policy google_ads_accounts_owner_update on google_ads_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists google_ads_accounts_owner_delete on google_ads_accounts;
create policy google_ads_accounts_owner_delete on google_ads_accounts
  for delete using (auth.uid() = user_id);

create or replace function set_google_ads_accounts_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists google_ads_accounts_set_updated_at on google_ads_accounts;
create trigger google_ads_accounts_set_updated_at
  before update on google_ads_accounts
  for each row execute function set_google_ads_accounts_updated_at();

-- ── Per-event Google Ads plan ────────────────────────────────────────────

create table if not exists google_ad_plans (
  id                    uuid        primary key default gen_random_uuid(),
  event_id              uuid        not null references events             (id) on delete cascade,
  user_id               uuid        not null references auth.users         (id) on delete cascade,
  google_ads_account_id uuid        references     google_ads_accounts     (id) on delete set null,

  total_budget          numeric(10, 2),
  google_budget         numeric(10, 2),
  google_budget_pct     numeric(5, 2),

  bidding_strategy      text check (
    bidding_strategy in ('max_conversions', 'manual_cpc', 'target_cpa')
  ),
  target_cpa            numeric(8, 2),

  geo_targets           jsonb       not null default '[]'::jsonb,
  rlsa_adjustments      jsonb       not null default '{}'::jsonb,
  ad_scheduling         jsonb       not null default '{}'::jsonb,
  campaigns             jsonb       not null default '[]'::jsonb,

  status                text        not null default 'draft'
    check (status in ('draft', 'live', 'completed', 'archived')),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists google_ad_plans_event_id_idx
  on google_ad_plans (event_id);
create index if not exists google_ad_plans_user_id_idx
  on google_ad_plans (user_id);

comment on table  google_ad_plans is
  'Per-event Google Ads (Search) plan. One row per event; campaigns/keywords/scheduling all live in jsonb so UI iteration is schema-free.';
comment on column google_ad_plans.geo_targets is
  'Array of { country, city, bid_adjustment } objects shaping the geo modifier stack.';
comment on column google_ad_plans.rlsa_adjustments is
  'Object { visitors: number, checkout_abandoners: number } — bid boosts on existing audiences.';
comment on column google_ad_plans.ad_scheduling is
  'Object { weekends_boost: number, payday_stretch: number, offpeak_reduction: number } — day-parting modifiers.';
comment on column google_ad_plans.campaigns is
  'Array of GoogleAdCampaign objects (see lib/types/google-ads.ts) — the campaign×ad-group×keyword tree the builder edits.';

alter table google_ad_plans enable row level security;

drop policy if exists google_ad_plans_owner_select on google_ad_plans;
create policy google_ad_plans_owner_select on google_ad_plans
  for select using (auth.uid() = user_id);

drop policy if exists google_ad_plans_owner_insert on google_ad_plans;
create policy google_ad_plans_owner_insert on google_ad_plans
  for insert with check (auth.uid() = user_id);

drop policy if exists google_ad_plans_owner_update on google_ad_plans;
create policy google_ad_plans_owner_update on google_ad_plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists google_ad_plans_owner_delete on google_ad_plans;
create policy google_ad_plans_owner_delete on google_ad_plans
  for delete using (auth.uid() = user_id);

create or replace function set_google_ad_plans_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists google_ad_plans_set_updated_at on google_ad_plans;
create trigger google_ad_plans_set_updated_at
  before update on google_ad_plans
  for each row execute function set_google_ad_plans_updated_at();

notify pgrst, 'reload schema';
