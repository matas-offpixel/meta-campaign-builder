-- 007_ad_plan_day_ticket_target.sql
--
-- Adds a per-day ticket_target column to ad_plan_days so the daily grid
-- can carry an explicit target per row alongside the plan-level
-- ad_plans.ticket_target aggregate.
--
-- Nullable: a null per-day target means "use the plan-level even-spread
-- default" — the grid renders floor(plan.ticket_target / days.length)
-- as a faded ghost in that case. Explicit zero is meaningful (no
-- target that day, e.g. dark days mid-tour).

alter table public.ad_plan_days
  add column if not exists ticket_target integer;

-- Refresh PostgREST schema cache so the new column is exposed via the API.
notify pgrst, 'reload schema';
