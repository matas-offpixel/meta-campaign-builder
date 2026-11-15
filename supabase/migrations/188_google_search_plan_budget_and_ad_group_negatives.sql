-- Migration 188 — Google Search: the plan budget reaches Google
--
-- google_search_plans.daily_budget: total_budget ÷ inclusive days of
-- date_range, 2dp. Written on every save (derivePlanDailyBudget in
-- lib/google-search/budget.ts); null when either input is missing. Push
-- splits it across campaigns with no daily budget of their own.
--
-- google_search_plans.pacing: how the plan budget is spread over the
-- window. Only 'even' changes what push sends today.
--
-- google_search_negatives.ad_group_id: an ad-group negative. Set only
-- together with campaign_id. Single-campaign imports write these for
-- negatives the sheet scoped to one source campaign, so a conquest ad
-- group does not inherit the competitor negatives of its siblings.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. The app writes all three columns on save. Idempotent.

alter table google_search_plans add column if not exists daily_budget numeric(12,2);
alter table google_search_plans add column if not exists pacing text not null default 'even';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'google_search_plans_pacing_check'
  ) then
    alter table google_search_plans
      add constraint google_search_plans_pacing_check
      check (pacing in ('even', 'front_loaded', 'phased'));
  end if;
end $$;

comment on column google_search_plans.daily_budget is
  'total_budget / inclusive days of date_range, 2dp. Derived on save; null without both. Migration 188.';
comment on column google_search_plans.pacing is
  'even | front_loaded | phased. Only even changes what push sends today. Migration 188.';

alter table google_search_negatives
  add column if not exists ad_group_id uuid references google_search_ad_groups(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'google_search_negatives_ad_group_needs_campaign'
  ) then
    alter table google_search_negatives
      add constraint google_search_negatives_ad_group_needs_campaign
      check (ad_group_id is null or campaign_id is not null);
  end if;
end $$;

comment on column google_search_negatives.ad_group_id is
  'Set = negative applies to this ad group only (always under campaign_id). Null = campaign-wide, or plan-wide when campaign_id is also null. Migration 188.';

create index if not exists google_search_negatives_ad_group_idx
  on google_search_negatives (ad_group_id)
  where ad_group_id is not null;

notify pgrst, 'reload schema';
