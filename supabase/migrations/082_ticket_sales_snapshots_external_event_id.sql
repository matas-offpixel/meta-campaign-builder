-- Attribute snapshots to a specific external listing so lifetime totals and
-- daily deltas stay correct when multiple links share one connection.

alter table ticket_sales_snapshots
  add column if not exists external_event_id text;

create index if not exists ticket_sales_snapshots_event_conn_external_idx
  on ticket_sales_snapshots (event_id, connection_id, external_event_id);

-- Backfill when exactly one link existed per (event_id, connection_id); keeps
-- legacy rows attributable after multi-link support ships.
update ticket_sales_snapshots tss
set external_event_id = etl.external_event_id
from event_ticketing_links etl
where tss.event_id = etl.event_id
  and tss.connection_id = etl.connection_id
  and tss.external_event_id is null
  and (
    select count(*)::int
    from event_ticketing_links e2
    where e2.event_id = tss.event_id
      and e2.connection_id = tss.connection_id
  ) = 1;
