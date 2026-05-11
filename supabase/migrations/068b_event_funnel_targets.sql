-- Migration 069 — event funnel targets

create table if not exists event_funnel_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  client_id uuid not null references clients(id),
  scope_type text not null check (scope_type in ('client_region', 'venue_code', 'event_id')),
  scope_value text not null,

  tofu_target_reach integer,
  tofu_target_cpm numeric(10,2),
  mofu_target_clicks integer,
  mofu_target_cpc numeric(10,2),
  bofu_target_lpv integer,
  bofu_target_cplpv numeric(10,2),
  bofu_target_purchases integer,
  bofu_target_cpa numeric(10,2),

  tofu_to_mofu_rate numeric(5,4),
  mofu_to_bofu_rate numeric(5,4),
  bofu_to_sale_rate numeric(5,4),

  source text not null check (source in ('manual', 'derived', 'fallback')),
  derived_from_event_id uuid references events(id),

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (client_id, scope_type, scope_value)
);

create index if not exists idx_event_funnel_targets_client
  on event_funnel_targets(client_id);

alter table event_funnel_targets enable row level security;

drop policy if exists event_funnel_targets_owner_select on event_funnel_targets;
create policy event_funnel_targets_owner_select on event_funnel_targets
  for select using (auth.uid() = user_id);

drop policy if exists event_funnel_targets_owner_insert on event_funnel_targets;
create policy event_funnel_targets_owner_insert on event_funnel_targets
  for insert with check (auth.uid() = user_id);

drop policy if exists event_funnel_targets_owner_update on event_funnel_targets;
create policy event_funnel_targets_owner_update on event_funnel_targets
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists event_funnel_targets_owner_delete on event_funnel_targets;
create policy event_funnel_targets_owner_delete on event_funnel_targets
  for delete using (auth.uid() = user_id);

create or replace function set_event_funnel_targets_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_event_funnel_targets_updated_at
  on event_funnel_targets;
create trigger trg_event_funnel_targets_updated_at
  before update on event_funnel_targets
  for each row execute function set_event_funnel_targets_updated_at();

notify pgrst, 'reload schema';
