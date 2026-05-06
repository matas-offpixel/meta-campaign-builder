-- Migration 079 — benchmark_alerts
--
-- Advisory alerts derived from account-wide creative/adset/campaign benchmarks
-- for the Today dashboard. Populated by nightly cron; RLS owner-scoped.

create table if not exists benchmark_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  event_id uuid references events (id) on delete cascade,
  alert_type text not null check (
    alert_type in (
      'creative_fatigue',
      'creative_scaling',
      'audience_outperform',
      'audience_underperform',
      'campaign_stalled',
      'campaign_breakout'
    )
  ),
  entity_type text not null check (
    entity_type in ('creative_concept', 'adset', 'campaign')
  ),
  entity_id text not null,
  entity_name text,
  metric text,
  metric_value numeric,
  benchmark_value numeric,
  deviation_pct numeric,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'dismissed')),
  surfaced_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index if not exists idx_benchmark_alerts_today
  on benchmark_alerts (user_id, status, surfaced_at desc)
  where status = 'open';

create unique index if not exists benchmark_alerts_open_dedupe_idx
  on benchmark_alerts (user_id, entity_id, alert_type)
  where status = 'open';

alter table benchmark_alerts enable row level security;

drop policy if exists benchmark_alerts_owner_all on benchmark_alerts;
create policy benchmark_alerts_owner_all on benchmark_alerts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
