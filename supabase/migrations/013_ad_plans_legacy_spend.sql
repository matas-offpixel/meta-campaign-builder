-- 013_ad_plans_legacy_spend.sql
--
-- Pre-plan ad spend on ad_plans.
--
-- Use case: Junction 2 had ad spend before the Bridge-series plan
-- started, and that spend isn't captured by any ad_plan_days row.
-- Without this column the plan's "actual vs planned" totals would
-- under-report what the event has actually paid out so far.
--
-- Nullable on purpose (not default 0) so the dashboard can distinguish
-- "no legacy spend" from "explicit £0 of legacy spend" — same
-- ergonomic as total_budget. Set on the plan-edit page; rolled into
-- planAllocated + the V.3 actual-vs-planned delta.

alter table ad_plans
  add column if not exists legacy_spend numeric(12, 2);

comment on column ad_plans.legacy_spend is
  'Ad spend incurred BEFORE this plan''s start_date that still counts toward the event''s marketing budget. Rolls into plan totals for actual vs planned comparison. Null = no legacy spend. Set at plan-edit time.';

notify pgrst, 'reload schema';
