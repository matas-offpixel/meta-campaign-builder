-- Migration 168 — campaign_plan_benchmarks_v
--
-- Audit two §1 query at the run grain, keyed on events.venue_key, with
-- PLAN_BENCHMARK_WINDOW applied (G34 / lib/plan/benchmark-window.ts):
--   per-signup (and other Meta-said units) — days strictly before general_sale_at
--   per-ticket — days through the last day that has a ticket entry
--
-- Spend (G31 / canon §2.3): a channel-agnostic result (tickets_sold) divides
-- all-channel spend; a channel's own result divides that channel's spend.
--
-- One row per (client, venue_key, event, unit, channel) with spend > 0 and
-- results > 0. Median + interpolated IQR are computed in
-- lib/plan/benchmarks.ts so the read path can exclude this plan's event
-- (audit §1.1: the view ships without `event_id <> :plan_event_id`).
--
-- The window is days (audit §6 item 10). start_time / end_time are ignored.
-- Foundation only. Apply after review. Do not apply in this run.

create or replace view campaign_plan_benchmarks_v as
with units(unit, channel, result_kind) as (
  values
    ('signup',   'meta',  'meta_regs'),
    ('ticket',   'all',   'tickets'),
    ('click',    'meta',  'link_clicks'),
    ('purchase', 'meta',  'meta_purchases'),
    ('lead',     'meta',  'meta_leads'),
    ('lpv',      'meta',  'landing_page_views'),
    ('click',    'tiktok','tiktok_results'),
    ('purchase', 'google','google_conversions')
),
win as (
  select
    e.id as event_id,
    e.client_id,
    e.venue_key,
    e.event_code,
    e.event_date,
    e.general_sale_at,
    (
      select max(r2.date)
      from event_daily_rollups r2
      where r2.event_id = e.id
        and coalesce(r2.tickets_sold, 0) > 0
    ) as last_ticket_day
  from events e
  where e.venue_key is not null
    and e.client_id is not null
),
run as (
  select
    w.client_id,
    w.venue_key,
    w.event_id,
    w.event_code,
    w.event_date,
    u.unit,
    u.channel,
    sum(
      case
        when u.channel = 'all' then
          coalesce(r.ad_spend, 0)
          + coalesce(r.tiktok_spend, 0)
          + coalesce(r.google_ads_spend, 0)
        when u.channel = 'meta' then coalesce(r.ad_spend, 0)
        when u.channel = 'tiktok' then coalesce(r.tiktok_spend, 0)
        when u.channel = 'google' then coalesce(r.google_ads_spend, 0)
      end
    ) as spend,
    sum(
      case u.result_kind
        when 'meta_regs' then r.meta_regs
        when 'tickets' then r.tickets_sold
        when 'link_clicks' then r.link_clicks
        when 'meta_purchases' then r.meta_purchases
        when 'meta_leads' then r.meta_leads
        when 'landing_page_views' then r.landing_page_views
        when 'tiktok_results' then r.tiktok_results
        when 'google_conversions' then r.google_ads_conversions
      end
    ) as results
  from win w
  join event_daily_rollups r on r.event_id = w.event_id
  cross join units u
  where
    (
      u.unit = 'ticket'
      and w.last_ticket_day is not null
      and r.date <= w.last_ticket_day
    )
    or (
      u.unit <> 'ticket'
      and (
        w.general_sale_at is null
        or r.date < (w.general_sale_at at time zone 'Europe/London')::date
      )
    )
  group by 1, 2, 3, 4, 5, 6, 7
)
select
  client_id,
  venue_key,
  event_id,
  event_code,
  event_date,
  unit,
  channel,
  spend,
  results,
  spend / results as cost
from run
where spend > 0
  and results > 0;

comment on view campaign_plan_benchmarks_v is
  'Per-run cost-per-result (client × venue_key × event × unit × channel). Signup window: days before general sale. Ticket window: through last ticket day. Days only. Median/IQR in lib/plan/benchmarks.ts.';
