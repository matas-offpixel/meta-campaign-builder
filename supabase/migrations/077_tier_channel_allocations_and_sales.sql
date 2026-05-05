-- Migration 077 — tier_channel_allocations + tier_channel_sales
--
-- Both tables key on (event_id, tier_name, channel_id). Every operator
-- update is an UPSERT against this natural key — the latest write is
-- the running total for that (event, tier, channel). This deliberately
-- mirrors PR 281's running-total semantics on additional_ticket_entries
-- so operators paste the partner's "total sold so far" rather than
-- adding a delta on top.
--
-- Read-time aggregation pivots on this trio:
--   tier total sold      = SUM(tier_channel_sales.tickets_sold)         per tier
--   tier total allocation = SUM(tier_channel_allocations.allocation_count) per tier
--   tier total revenue   = SUM(tier_channel_sales.revenue_amount)        per tier
--
-- The 4TF channel is special: its rows on tier_channel_allocations are
-- editable by ops, but its rows on tier_channel_sales are written by
-- the existing 4thefans rollup-sync path (which writes the
-- event_ticket_tiers latest snapshot). Reads coalesce: if a 4TF row
-- exists in tier_channel_sales, use it; otherwise fall back to
-- event_ticket_tiers.quantity_sold for that tier.

create table if not exists public.tier_channel_allocations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  tier_name text not null,
  channel_id uuid not null references public.tier_channels (id) on delete cascade,
  allocation_count integer not null check (allocation_count >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, tier_name, channel_id)
);

comment on table public.tier_channel_allocations is
  'Per (event, tier, channel) allocation count. UPSERT semantics: the latest write replaces the prior allocation for that natural key.';

create index if not exists tier_channel_allocations_event_id_idx
  on public.tier_channel_allocations (event_id);
create index if not exists tier_channel_allocations_channel_id_idx
  on public.tier_channel_allocations (channel_id);

alter table public.tier_channel_allocations enable row level security;

drop policy if exists tier_channel_allocations_select on public.tier_channel_allocations;
create policy tier_channel_allocations_select on public.tier_channel_allocations
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists tier_channel_allocations_insert on public.tier_channel_allocations;
create policy tier_channel_allocations_insert on public.tier_channel_allocations
  for insert with check (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists tier_channel_allocations_update on public.tier_channel_allocations;
create policy tier_channel_allocations_update on public.tier_channel_allocations
  for update using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists tier_channel_allocations_delete on public.tier_channel_allocations;
create policy tier_channel_allocations_delete on public.tier_channel_allocations
  for delete using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );


create table if not exists public.tier_channel_sales (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  tier_name text not null,
  channel_id uuid not null references public.tier_channels (id) on delete cascade,
  tickets_sold integer not null check (tickets_sold >= 0),
  revenue_amount numeric not null default 0 check (revenue_amount >= 0),
  revenue_overridden boolean not null default false,
  notes text,
  snapshot_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, tier_name, channel_id)
);

comment on table public.tier_channel_sales is
  'Per (event, tier, channel) running total of tickets sold + revenue. UPSERT semantics: latest snapshot wins. revenue_overridden=false means revenue is auto-computed from price × tickets_sold at write time; revenue_overridden=true means the operator entered a manual figure.';

create index if not exists tier_channel_sales_event_id_idx
  on public.tier_channel_sales (event_id);
create index if not exists tier_channel_sales_channel_id_idx
  on public.tier_channel_sales (channel_id);

alter table public.tier_channel_sales enable row level security;

drop policy if exists tier_channel_sales_select on public.tier_channel_sales;
create policy tier_channel_sales_select on public.tier_channel_sales
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists tier_channel_sales_insert on public.tier_channel_sales;
create policy tier_channel_sales_insert on public.tier_channel_sales
  for insert with check (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists tier_channel_sales_update on public.tier_channel_sales;
create policy tier_channel_sales_update on public.tier_channel_sales
  for update using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

drop policy if exists tier_channel_sales_delete on public.tier_channel_sales;
create policy tier_channel_sales_delete on public.tier_channel_sales
  for delete using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );
