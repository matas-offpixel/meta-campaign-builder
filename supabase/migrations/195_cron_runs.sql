-- 195 — one row per cron run, so a cron that writes nothing can be told
-- apart from a cron that had nothing to write.
--
-- `cron_health_reports` cannot carry this: it holds ONE snapshot row per
-- health-check run, built by sampling the freshest write in each monitored
-- table. That detects "the table went cold" but structurally cannot detect
-- "the cron ran, succeeded, and wrote zero rows" — which is how
-- snapshot-tier-channel-sales-daily reported ok for a week while writing
-- nothing, and how the rollup tickets leg has been dead since 3 Sep.
--
-- Shape follows `google_ads_insights_runs` (migration 192), which is the
-- same idea scoped to one cron.

create table if not exists cron_runs (
  id            uuid primary key default gen_random_uuid(),
  cron_name     text not null,
  started_at    timestamptz not null,
  finished_at   timestamptz not null default now(),
  ok            boolean not null,
  -- Rows this run actually wrote. 0 is meaningful and must be recorded,
  -- never left null to mean "didn't say".
  rows_written  integer not null default 0,
  -- Rows considered before filtering, so "0 written of 0 candidates"
  -- (nothing to do) reads differently from "0 written of 54" (a fault).
  rows_considered integer not null default 0,
  -- Per-cron evidence the evaluator needs without calling an external API:
  -- e.g. the rollup leg records each event's claimed campaign ids and the
  -- spend it saw, so "zero spend" can be judged DB-side.
  detail        jsonb not null default '{}'::jsonb,
  error         text
);

create index if not exists cron_runs_name_started_idx
  on cron_runs (cron_name, started_at desc);

-- Retention: the evaluator only ever looks back a few intervals.
create index if not exists cron_runs_started_idx on cron_runs (started_at desc);

alter table cron_runs enable row level security;

-- Service-role writes only; operators read through the dashboard, which
-- already runs server-side with the service role.
drop policy if exists cron_runs_service_all on cron_runs;
create policy cron_runs_service_all on cron_runs
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
