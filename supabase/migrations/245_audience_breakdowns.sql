-- Migration 245 — audience breakdowns per campaign-day (dashboard v2 phase 2, HE1)
--
-- docs/design-record/2026-11-13-dashboard-v2-phase-2.html, E1 "Who we
-- reached" and E8 HE1: the platforms' own audience figures, stored per
-- campaign-day and attributed to a show.
--
--   meta_audience_breakdowns: GET /act_{id}/insights at level=campaign,
--     time_increment=1, once with breakdowns=age,gender and once with
--     breakdowns=region. Spend, impressions, clicks, link clicks, complete
--     registrations, purchases and purchase value (revenue). Meta returns
--     no conversions under breakdowns=region (0 of 500 signups on
--     NX26-LOCKLEAD, 15 Nov), so region rows carry delivery only; the
--     result columns stay for the shape and read 0.
--   tiktok_audience_breakdowns: /report/integrated/get/ AUDIENCE report at
--     AUCTION_CAMPAIGN with stat_time_day, once by age+gender and once by
--     province_id folded to the UK nation. Spend, impressions and clicks
--     only: TikTok doesn't report results by age reliably (E1).
--
-- One row per campaign, day, breakdown and segment. A segment column the
-- breakdown doesn't use is '' (never NULL), so the primary key holds.
--
-- event_id is the show the campaign belonged to when the row was written,
-- by the dashboard's rule (lib/dashboard/sales-calc/figures.ts
-- metaCampaignOwners; TikTok: lib/attribution/campaign-owner.ts): a
-- campaign_event_overrides row (migration 240) first, then, for Meta, the
-- id in events.meta_campaign_id, then the "[CODE]" in the name exactly as
-- written. The readers (lib/audience-breakdowns/read.ts) check it again
-- against today's overrides. The writer never sends event_id or
-- campaign_name as NULL: an unattributed row leaves the stored value.
--
-- Service role writes (the ad-daily-insights cron's ENABLE_AUDIENCE_BREAKDOWNS
-- step and scripts/backfill-audience-breakdowns.mts). Owners read their own
-- events' rows. Not applied from this branch: ops applies it from main.

create table if not exists public.meta_audience_breakdowns (
  meta_campaign_id  text not null check (meta_campaign_id <> ''),
  date              date not null,
  breakdown         text not null check (breakdown in ('age_gender', 'region')),
  age               text not null default '',
  gender            text not null default '',
  region            text not null default '',
  ad_account_id     text not null,
  campaign_name     text,
  event_id          uuid references public.events (id) on delete set null,
  spend             numeric(14, 2) not null default 0,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  link_clicks       bigint not null default 0,
  registrations     integer not null default 0,
  purchases         integer not null default 0,
  purchase_value    numeric(14, 2) not null default 0,
  fetched_at        timestamptz not null default now(),
  primary key (meta_campaign_id, date, breakdown, age, gender, region),
  check (
    (breakdown = 'age_gender' and region = '')
    or (breakdown = 'region' and age = '' and gender = '')
  )
);

comment on table public.meta_audience_breakdowns is
  'Meta insights per campaign-day by age+gender or by region (dashboard v2 HE1, migration 245). Read-only from Meta; event_id is the show by the dashboard''s campaign rule at write time.';
comment on column public.meta_audience_breakdowns.registrations is
  'Complete registrations: the first of offsite_conversion.fb_pixel_complete_registration, complete_registration present (never summed), as ad_daily_insights.';
comment on column public.meta_audience_breakdowns.purchase_value is
  'Revenue: action_values for offsite_conversion.fb_pixel_purchase, in the ad account currency.';

create index if not exists meta_audience_breakdowns_event_date
  on public.meta_audience_breakdowns (event_id, date);
create index if not exists meta_audience_breakdowns_account_date
  on public.meta_audience_breakdowns (ad_account_id, date);

create table if not exists public.tiktok_audience_breakdowns (
  tiktok_campaign_id  text not null check (tiktok_campaign_id <> ''),
  date                date not null,
  breakdown           text not null check (breakdown in ('age_gender', 'nation')),
  age                 text not null default '',
  gender              text not null default '',
  nation              text not null default '',
  advertiser_id       text not null,
  campaign_name       text,
  event_id            uuid references public.events (id) on delete set null,
  spend               numeric(14, 2) not null default 0,
  impressions         bigint not null default 0,
  clicks              bigint not null default 0,
  fetched_at          timestamptz not null default now(),
  primary key (tiktok_campaign_id, date, breakdown, age, gender, nation),
  check (
    (breakdown = 'age_gender' and nation = '')
    or (breakdown = 'nation' and age = '' and gender = '')
  )
);

comment on table public.tiktok_audience_breakdowns is
  'TikTok AUDIENCE report per campaign-day by age+gender or UK nation (dashboard v2 HE1, migration 245). Spend, impressions, clicks only. Read-only from TikTok.';
comment on column public.tiktok_audience_breakdowns.nation is
  'England, Scotland, Wales, Northern Ireland (province_id 6269131, 2638360, 2634895, 2641364), "Outside the UK", or "Unknown".';

create index if not exists tiktok_audience_breakdowns_event_date
  on public.tiktok_audience_breakdowns (event_id, date);
create index if not exists tiktok_audience_breakdowns_advertiser_date
  on public.tiktok_audience_breakdowns (advertiser_id, date);

alter table public.meta_audience_breakdowns enable row level security;
alter table public.tiktok_audience_breakdowns enable row level security;

drop policy if exists meta_audience_breakdowns_select_own on public.meta_audience_breakdowns;
create policy meta_audience_breakdowns_select_own on public.meta_audience_breakdowns
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists tiktok_audience_breakdowns_select_own on public.tiktok_audience_breakdowns;
create policy tiktok_audience_breakdowns_select_own on public.tiktok_audience_breakdowns
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

-- No insert, update or delete policy: service role only.
