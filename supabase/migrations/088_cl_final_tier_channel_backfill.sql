-- Migration 088 — CL Final London 4TF tier_channel_sales backfill
--
-- Backfills provider-owned 4TF channel sales for the four Arsenal CL Final
-- London venue rows (4TF26-ARSENAL-CL-FL). Reconstructs from
-- event_ticket_tiers, preserving every existing tier_channel_sales row.
--
-- IMPORTANT: insert-only, idempotent via the natural key
-- (event_id, tier_name, channel_id). Never null/refill.

with rows_to_insert as (
  select
    ett.event_id,
    ett.tier_name,
    tc.id as channel_id,
    greatest(0, ett.quantity_sold)::integer as tickets_sold,
    greatest(0, coalesce(ett.price, 0) * ett.quantity_sold)::numeric as revenue_amount,
    false as revenue_overridden,
    'Migration 088 CL Final London 4TF backfill'::text as notes,
    now() as snapshot_at,
    now() as updated_at
  from public.event_ticket_tiers ett
  join public.events e
    on e.id = ett.event_id
  join public.tier_channels tc
    on tc.client_id = e.client_id
   and tc.channel_name = '4TF'
   and tc.is_automatic = true
  where e.event_code = '4TF26-ARSENAL-CL-FL'
    and ett.quantity_sold > 0
)
insert into public.tier_channel_sales (
  event_id,
  tier_name,
  channel_id,
  tickets_sold,
  revenue_amount,
  revenue_overridden,
  notes,
  snapshot_at,
  updated_at
)
select
  r.event_id,
  r.tier_name,
  r.channel_id,
  r.tickets_sold,
  r.revenue_amount,
  r.revenue_overridden,
  r.notes,
  r.snapshot_at,
  r.updated_at
from rows_to_insert r
where not exists (
  select 1
  from public.tier_channel_sales existing
  where existing.event_id = r.event_id
    and existing.tier_name = r.tier_name
    and existing.channel_id = r.channel_id
);
