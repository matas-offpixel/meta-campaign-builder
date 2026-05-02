-- Clear historical ticket/revenue zero-padding left behind before
-- current-snapshot providers wrote daily deltas.
--
-- Keep Meta spend and all other platform columns intact; only the
-- ticketing-owned columns are nulled so the Daily Tracker renders
-- unknown historical ticket/revenue data as dashes instead of zeros.

with current_snapshot_events as (
  select distinct l.event_id
  from event_ticketing_links l
  join client_ticketing_connections c on c.id = l.connection_id
  where c.provider in ('fourthefans', 'foursomething_internal')
),
first_positive_rollup as (
  select
    r.event_id,
    min(r.date) as first_date
  from event_daily_rollups r
  join current_snapshot_events e on e.event_id = r.event_id
  where r.source_eventbrite_at is not null
    and (
      coalesce(r.tickets_sold, 0) > 0
      or coalesce(r.revenue, 0) > 0
    )
  group by r.event_id
)
update event_daily_rollups r
set
  tickets_sold = null,
  revenue = null,
  source_eventbrite_at = null,
  updated_at = now()
from first_positive_rollup f
where r.event_id = f.event_id
  and r.date < f.first_date
  and r.source_eventbrite_at is not null
  and r.tickets_sold = 0
  and r.revenue = 0;
