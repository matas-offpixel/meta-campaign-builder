-- Migration 187 — ad_daily_insights: what Meta says the ad set is for
--
-- Stages ad-days the app never launched (no launched_ad_sets.phase_at_launch)
-- by the campaign objective: Complete Registration / leads → presale,
-- everything else known → on_sale (phaseFromMetaObjective in
-- lib/launched-ad-sets/snapshot.ts). Under OUTCOME_SALES the insights row
-- cannot tell Complete Registration from Purchase (both
-- OFFSITE_CONVERSIONS), so the ad set's promoted event is read too.
--
-- Written by /api/cron/ad-daily-insights and
-- scripts/backfill-insights-objective.mts. Nullable: rows before this
-- migration stay null until the backfill runs.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent.

alter table ad_daily_insights add column if not exists campaign_objective text;
alter table ad_daily_insights add column if not exists optimization_goal text;
alter table ad_daily_insights add column if not exists promoted_event text;

comment on column ad_daily_insights.campaign_objective is
  'Insights field objective (level=ad): the campaign objective, e.g. OUTCOME_SALES, OUTCOME_AWARENESS, legacy LINK_CLICKS. Migration 187.';
comment on column ad_daily_insights.optimization_goal is
  'Insights field optimization_goal (level=ad): the ad set goal, e.g. OFFSITE_CONVERSIONS, REACH, LANDING_PAGE_VIEWS. Migration 187.';
comment on column ad_daily_insights.promoted_event is
  'Ad set promoted_object.custom_event_type (GET /?ids=<adset ids>&fields=promoted_object), e.g. COMPLETE_REGISTRATION, PURCHASE. Null when the ad set has no promoted object or it has not been read yet. Migration 187.';

create index if not exists ad_daily_insights_adset_null_event_idx
  on ad_daily_insights (ad_account_id, meta_adset_id)
  where promoted_event is null;

notify pgrst, 'reload schema';
