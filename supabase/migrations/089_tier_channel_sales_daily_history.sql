-- Migration 089 — tier_channel_sales_daily_history
--
-- Per-event, per-day snapshot of the all-channel cumulative ticket total.
-- Records are written by:
--
--   source_kind = 'cron'
--     Nightly at 23:55 UTC (≈ midnight London) via
--     /api/cron/snapshot-tier-channel-sales-daily. Captures the
--     SUM(tier_channel_sales.tickets_sold) for every event that was
--     updated in the last 48 h. This is the forward-going live history.
--
--   source_kind = 'smoothed_historical'
--     One-shot backfill via /api/admin/smooth-historical-tier-channel-sales.
--     Distributes the gap between the ticket_sales_snapshots monotonic
--     envelope and the current tier_channel_sales SUM proportionally
--     across a specified date window, producing a smooth curve for events
--     that had no daily capture before this table existed.
--
--   source_kind = 'manual_backfill'
--     Single-event, single-date writes via
--     /api/admin/snapshot-tier-channel-sales for ad-hoc corrections or
--     new-client onboarding.
--
-- Primary consumer: buildEventCumulativeTicketTimeline in
-- lib/dashboard/venue-trend-points.ts — daily_history rows take priority
-- over the ticket_sales_snapshots envelope for dates they cover.
--
-- Unique constraint on (event_id, snapshot_date) enforces one row per
-- (event, day). ON CONFLICT ... DO UPDATE makes every write idempotent.

create table if not exists public.tier_channel_sales_daily_history (
  id             uuid        primary key default gen_random_uuid(),
  event_id       uuid        not null references public.events (id) on delete cascade,
  snapshot_date  date        not null,
  tickets_sold_total integer not null check (tickets_sold_total >= 0),
  revenue_total  numeric(12,2) not null default 0 check (revenue_total >= 0),
  source_kind    text        not null check (source_kind in ('cron', 'manual_backfill', 'smoothed_historical')),
  captured_at    timestamptz not null default now(),
  unique (event_id, snapshot_date)
);

comment on table public.tier_channel_sales_daily_history is
  'Per-event per-day cumulative ticket snapshot derived from tier_channel_sales. '
  'source_kind discriminates live cron rows from smoothed-historical backfill rows '
  'so operators can audit provenance and the tooltip can flag estimates.';

comment on column public.tier_channel_sales_daily_history.tickets_sold_total is
  'Cumulative tickets sold across ALL channels for this event as of end-of-day.';

comment on column public.tier_channel_sales_daily_history.revenue_total is
  'Cumulative revenue across ALL channels for this event as of end-of-day.';

comment on column public.tier_channel_sales_daily_history.source_kind is
  'cron = nightly live snapshot; smoothed_historical = proportional backfill; '
  'manual_backfill = ad-hoc operator write.';

create index if not exists tier_channel_sales_daily_history_event_date_idx
  on public.tier_channel_sales_daily_history (event_id, snapshot_date desc);

alter table public.tier_channel_sales_daily_history enable row level security;

-- Reads: authenticated users see rows for events they own; service role sees all.
drop policy if exists tier_channel_sales_daily_history_select
  on public.tier_channel_sales_daily_history;
create policy tier_channel_sales_daily_history_select
  on public.tier_channel_sales_daily_history
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

-- Writes: service-role only (cron + admin routes; no browser writes).
drop policy if exists tier_channel_sales_daily_history_insert
  on public.tier_channel_sales_daily_history;
create policy tier_channel_sales_daily_history_insert
  on public.tier_channel_sales_daily_history
  for insert with check (auth.role() = 'service_role');

drop policy if exists tier_channel_sales_daily_history_update
  on public.tier_channel_sales_daily_history;
create policy tier_channel_sales_daily_history_update
  on public.tier_channel_sales_daily_history
  for update using (auth.role() = 'service_role');

drop policy if exists tier_channel_sales_daily_history_delete
  on public.tier_channel_sales_daily_history;
create policy tier_channel_sales_daily_history_delete
  on public.tier_channel_sales_daily_history
  for delete using (auth.role() = 'service_role');
