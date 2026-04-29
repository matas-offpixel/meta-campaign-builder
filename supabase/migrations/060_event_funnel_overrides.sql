-- Migration 060 — Funnel planner overrides and campaign stage tagging
--
-- 056 already exists on main. This migration keeps the requested Funnel
-- Planner foundation ordered after the current TikTok reporting migrations.

create table if not exists event_funnel_overrides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  event_code text,

  -- Conversion rates are stored as decimals. Some planning multipliers can
  -- legitimately exceed 1.0, so only reject negative values.
  tofu_to_mofu_rate numeric check (tofu_to_mofu_rate is null or tofu_to_mofu_rate >= 0),
  mofu_to_bofu_rate numeric check (mofu_to_bofu_rate is null or mofu_to_bofu_rate >= 0),
  bofu_to_reg_rate numeric default 0.1827 check (bofu_to_reg_rate is null or bofu_to_reg_rate >= 0),
  reg_to_sale_rate numeric default 0.51 check (reg_to_sale_rate is null or reg_to_sale_rate >= 0),
  organic_lift_rate numeric default 0.57 check (organic_lift_rate is null or organic_lift_rate >= 0),

  -- Cost per stage.
  cost_per_reach numeric check (cost_per_reach is null or cost_per_reach >= 0),
  cost_per_lpv numeric check (cost_per_lpv is null or cost_per_lpv >= 0),
  cost_per_reg numeric default 1.00 check (cost_per_reg is null or cost_per_reg >= 0),

  sellout_target_override integer check (
    sellout_target_override is null or sellout_target_override >= 0
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint funnel_override_scope_check check (
    (event_id is not null and event_code is null) or
    (event_id is null and event_code is not null)
  )
);

create unique index if not exists event_funnel_overrides_scope_unique_idx
  on event_funnel_overrides (client_id, coalesce(event_id::text, event_code));

create index if not exists event_funnel_overrides_client_idx
  on event_funnel_overrides (client_id);

create or replace function set_event_funnel_overrides_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_event_funnel_overrides_updated_at
  on event_funnel_overrides;

create trigger set_event_funnel_overrides_updated_at
before update on event_funnel_overrides
for each row
execute function set_event_funnel_overrides_updated_at();

alter table event_funnel_overrides enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'event_funnel_overrides'
      and policyname = 'service role only'
  ) then
    execute
      'create policy "service role only" on event_funnel_overrides ' ||
      'for all using (false) with check (false)';
  end if;
end $$;

-- The app currently reads live Meta campaigns from Graph rather than a local
-- `meta_campaigns` table. Keep this conditional so production environments
-- that already have that table receive the manual stage override column,
-- while fresh/local schemas without it can still apply the migration.
do $$
begin
  if to_regclass('public.meta_campaigns') is not null then
    alter table meta_campaigns
      add column if not exists funnel_stage text;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'meta_campaigns_funnel_stage_check'
    ) then
      alter table meta_campaigns
        add constraint meta_campaigns_funnel_stage_check
        check (funnel_stage in ('TOFU', 'MOFU', 'BOFU') or funnel_stage is null);
    end if;
  end if;
end $$;
