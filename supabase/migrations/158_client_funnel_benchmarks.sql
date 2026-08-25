-- Migration 158 — client_funnel_benchmarks (Phase C.1)
--
-- Per-client funnel rates for the v2 stages (reach→click, click→LPV,
-- LPV→purchase). Distinct from event_funnel_overrides (060), which
-- stores TOFU/MOFU/BOFU planner multipliers — different stage model,
-- do not merge.
--
-- No learning job in this PR. The read path returns seed 15/50/5 with
-- provenance 'seed' when this table is absent or empty.
--
-- Foundation only. Apply manually after review. Do not apply in this run.

create table if not exists client_funnel_benchmarks (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  stage       text not null
    check (stage in ('reach_to_click', 'click_to_lpv', 'lpv_to_purchase')),
  rate        numeric(8, 6) not null
    check (rate >= 0 and rate <= 1),
  n           integer not null default 0
    check (n >= 0),
  confidence  numeric(8, 6)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  provenance  text not null
    check (provenance in ('seed', 'learned', 'manually-overridden')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, stage)
);

comment on table client_funnel_benchmarks is
  'Per-client funnel-stage rates. Empty/absent = industry seed 15/50/5 at read time. Phase and platform keys are later columns — not in C.1.';
comment on column client_funnel_benchmarks.n is
  'Observation count feeding a learned rate. 0 for seed / unused until C.2.';
comment on column client_funnel_benchmarks.provenance is
  'seed | learned | manually-overridden. Read path never invents learned.';

create index if not exists client_funnel_benchmarks_client_idx
  on client_funnel_benchmarks (client_id);

alter table client_funnel_benchmarks enable row level security;

drop policy if exists "Users can read own client_funnel_benchmarks"
  on client_funnel_benchmarks;
create policy "Users can read own client_funnel_benchmarks"
  on client_funnel_benchmarks
  for select
  using (
    exists (
      select 1 from clients c
      where c.id = client_id and c.user_id = auth.uid()
    )
  );

drop trigger if exists client_funnel_benchmarks_updated_at on client_funnel_benchmarks;
create trigger client_funnel_benchmarks_updated_at
  before update on client_funnel_benchmarks
  for each row execute procedure update_updated_at_column();

notify pgrst, 'reload schema';
