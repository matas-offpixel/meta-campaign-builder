-- Migration 209 — retire campaign_daily_insights and event_funnel_overrides
--
-- campaign_daily_insights has no reader or writer on main. Migration 185
-- replaced it with ad_daily_insights.
-- event_funnel_overrides (060) has no rows and no reader. The live funnel
-- store is client_funnel_benchmarks (158).
--
-- Apply by hand. Not applied by this branch.

drop table if exists campaign_daily_insights;

drop trigger if exists set_event_funnel_overrides_updated_at on event_funnel_overrides;
drop function if exists set_event_funnel_overrides_updated_at();
drop table if exists event_funnel_overrides;
