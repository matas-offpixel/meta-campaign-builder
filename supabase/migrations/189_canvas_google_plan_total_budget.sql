-- Migration 189 — canvas Google plans: total_budget was the daily figure
--
-- Before PR #1035 the canvas adapter (lib/plan/adapters/google.ts) wrote
-- `intent.budget.googleDaily` into BOTH google_search_plans.total_budget
-- and its one campaign's daily_budget. Migration 188's overspend check
-- reads total_budget as the whole-window total, so every such plan
-- longer than a day would be blocked at preflight and push.
--
-- Rewrites total_budget = daily × inclusive days of date_range, and sets
-- daily_budget (188), for exactly the rows that shape produced:
--   - linked from campaign_plan_google_launch.draft_id (canvas origin)
--   - exactly one campaign
--   - that campaign's daily_budget = the plan's total_budget
--   - a valid date_range of two days or more
-- Prod count when written (2026-10-08): 0 rows. Kept so drafts prepared on
-- main before #1035 deploys are corrected too.
--
-- Requires 188. Apply by hand after 188: prod first, then CI, only when
-- the PR is about to merge. Idempotent: a corrected row's total no longer
-- equals its daily budget.

with candidates as (
  select
    p.id,
    c.daily_budget as daily,
    ((p.date_range ->> 'until')::date - (p.date_range ->> 'since')::date) + 1 as days
  from google_search_plans p
  join campaign_plan_google_launch l on l.draft_id = p.id
  join google_search_campaigns c on c.plan_id = p.id
  where p.total_budget is not null
    and c.daily_budget = p.total_budget
    and (select count(*) from google_search_campaigns c2 where c2.plan_id = p.id) = 1
    and p.date_range ->> 'since' ~ '^\d{4}-\d{2}-\d{2}$'
    and p.date_range ->> 'until' ~ '^\d{4}-\d{2}-\d{2}$'
)
update google_search_plans p
set
  total_budget = round(candidates.daily * candidates.days, 2),
  daily_budget = candidates.daily
from candidates
where p.id = candidates.id
  and candidates.days >= 2;

notify pgrst, 'reload schema';
