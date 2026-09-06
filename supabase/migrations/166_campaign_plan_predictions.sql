-- Migration 166 — campaign_plan_predictions (canon §1.3; audit two)
-- One row per (plan, metric, unit) written at LAUNCH, its actual written at CLOSE.
-- LEARN reads rows and never recomputes. Foundation only — apply after review.
--
-- The prediction window is days, not times (audit two §2 / §6 item 10).
-- campaign_plans.start_time / end_time exist; event_daily_rollups is per day.
-- Writers and the benchmark view slice on dates only.

create table if not exists campaign_plan_predictions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  plan_id        uuid not null references campaign_plans (id) on delete cascade,
  metric         text not null
    check (metric in ('cost_per_unit', 'split_meta', 'split_tiktok', 'split_google', 'pace_daily')),
  unit           text
    check (unit is null or unit in ('reg', 'click', 'lpv', 'purchase', 'view')),   -- 165 vocabulary
  value          numeric(12, 4) not null,
  line_kind      text not null check (line_kind in ('measured', 'estimated', 'not_yet')),
  benchmark_rung text
    check (benchmark_rung is null or benchmark_rung in ('venue', 'client', 'client_thin', 'starting_point')),
  n              integer not null default 0 check (n >= 0),
  runs_used      text[] not null default '{}',          -- event codes, verbatim, event_date order
  date_range     daterange,                             -- first_run .. last_run of runs_used
  source_kind    text not null check (source_kind in ('meta_said', 'our_tag', 'entered')),
  predicted_at   timestamptz not null default now(),
  actual         numeric(12, 4),
  actual_at      timestamptz,
  closed_reason  text check (closed_reason is null or closed_reason in ('show', 'archived')),
  created_at     timestamptz not null default now(),
  constraint cpp_actual_pair  check ((actual is null) = (actual_at is null)),
  constraint cpp_closed_pair  check ((closed_reason is null) = (actual_at is null)),
  constraint cpp_unit_for_cost check (metric <> 'cost_per_unit' or unit is not null),
  unique (plan_id, metric, unit)
);
create index if not exists campaign_plan_predictions_open_idx
  on campaign_plan_predictions (plan_id) where actual_at is null;
alter table campaign_plan_predictions enable row level security;
create policy "Users can manage their own campaign_plan_predictions"
  on campaign_plan_predictions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table campaign_plan_predictions is
  'Predicted numbers written at Launch; actual written at close (show or archive). Window is days.';
comment on column campaign_plan_predictions.date_range is
  'First and last run dates of runs_used. Days only — start_time / end_time are not part of this window.';
