-- Migration 256 — the Retargeting campaign, PR A: the Create line, its daily read, the tier audiences and list roles
--
-- docs/design-record/2026-11-17-retargeting-campaign.html, RT1, RT2, RT4,
-- RT8 and HR1–HR3.
--
-- 1. A new line kind, retargeting_campaign: the show's Create line for its
--    `{code} · Retargeting` campaign (three tier ad sets with budgets on the
--    ad sets, made through the Purchase create path).
-- 2. A new run kind, retargeting: the daily 08:00 London read writes one
--    proposal per show under campaign_key `{code} · Retargeting`; earlier
--    unanswered lines expire at the next read (RT5, as R4). Its objective is
--    purchase.
-- 3. A new stored-audience kind, retargeting_campaign: each tier audience's
--    Meta id, keyed by its source and window (part), so Retry never builds a
--    second one.
-- 4. Customer lists with a role (RT2, HR2): the customer-audience wizard
--    writes a meta_custom_audiences row for each list it uploads, with
--    audience_subtype customer_list, a list_role (signups, similar, buyers)
--    and the show (event_id). Lists have no window, so retention_days is
--    null for a customer list and only for one.
--
-- Every CHECK keeps the values installed before it: the line kinds of 232,
-- 242 and 244, the run kinds of 232, the objectives of 232, the stored
-- audience kinds of 237 and the subtypes of 068c and 095. The Meta write
-- ledger is unchanged: the create path reuses 236, 237 and 243's op kinds
-- (refresh_campaign_create, refresh_adset_create, refresh_ad_create,
-- refresh_creative_create, refresh_custom_conversion_create,
-- refresh_campaign_lifetime_budget_update, adset_status_update,
-- refresh_campaign_status_update), keyed on the line and the tier.
--
-- Write only. Not applied from this branch. Matas applies from main.

-- 1. The Create line.
alter table public.onsale_refresh_lines
  drop constraint if exists onsale_refresh_lines_kind_check;

alter table public.onsale_refresh_lines
  add constraint onsale_refresh_lines_kind_check
  check (kind in ('add_creative', 'claim_ready', 'pause_creative', 'bring_back_audience', 'missing_default', 'drop_audience', 'move_budget', 'purchase_campaign', 'scale_purchase', 'copy_audience', 'retargeting_campaign'));

-- 2. The daily read's proposal.
alter table public.onsale_refresh_proposals
  drop constraint if exists onsale_refresh_proposals_run_kind_check;

alter table public.onsale_refresh_proposals
  add constraint onsale_refresh_proposals_run_kind_check
  check (run_kind in ('cycle', 'mid_cycle', 'shadow', 'retargeting'));

alter table public.onsale_refresh_proposals
  drop constraint if exists onsale_refresh_proposals_objective_check;

alter table public.onsale_refresh_proposals
  add constraint onsale_refresh_proposals_objective_check
  check (objective in ('initiate_checkout', 'landing_page_view', 'complete_registration', 'purchase'));

-- 3. The tier audiences.
alter table public.onsale_refresh_audiences
  drop constraint if exists onsale_refresh_audiences_kind_check;

alter table public.onsale_refresh_audiences
  add constraint onsale_refresh_audiences_kind_check
  check (kind in ('retargeting', 'registrations_lookalike', 'cluster', 'retargeting_campaign'));

-- 4. Customer lists with a role.
alter table public.meta_custom_audiences
  add column if not exists list_role text;

alter table public.meta_custom_audiences
  drop constraint if exists meta_custom_audiences_list_role_check;

alter table public.meta_custom_audiences
  add constraint meta_custom_audiences_list_role_check
  check (list_role is null or (audience_subtype = 'customer_list' and list_role in ('signups', 'similar', 'buyers')));

-- Drop the live subtype and retention checks by name. On prod they read
-- "CHECK ((audience_subtype = ANY (ARRAY[...])))" and
-- "CHECK (((retention_days > 0) AND (retention_days <= 365)))", so a match
-- on the definition text is not used.
alter table public.meta_custom_audiences
  drop constraint if exists meta_custom_audiences_audience_subtype_check;

alter table public.meta_custom_audiences
  drop constraint if exists meta_custom_audiences_retention_days_check;

alter table public.meta_custom_audiences
  add constraint meta_custom_audiences_audience_subtype_check
  check (audience_subtype in (
    'page_engagement_fb',
    'page_engagement_ig',
    'page_followers_fb',
    'page_followers_ig',
    'video_views',
    'website_pixel',
    'lookalike',
    'customer_list'
  ));

alter table public.meta_custom_audiences
  alter column retention_days drop not null;

alter table public.meta_custom_audiences
  add constraint meta_custom_audiences_retention_days_check
  check (
    (audience_subtype = 'customer_list' and retention_days is null)
    or (audience_subtype <> 'customer_list' and retention_days is not null and retention_days > 0 and retention_days <= 365)
  );

create index if not exists meta_custom_audiences_event_list_role_idx
  on public.meta_custom_audiences (event_id, list_role)
  where list_role is not null;

comment on column public.meta_custom_audiences.list_role is
  'RT2 (docs/design-record/2026-11-17-retargeting-campaign.html): a customer list''s role for the show''s Retargeting campaign — signups go in Bottom, similar in Mid Bottom, buyers are left out of every tier. Null on every other audience.';

notify pgrst, 'reload schema';
