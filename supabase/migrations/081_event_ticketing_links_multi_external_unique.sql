-- Allow multiple provider listings (distinct external_event_id) per dashboard event
-- on the same connection (e.g. 4theFans presale + gen sale split).

alter table event_ticketing_links
  drop constraint if exists event_ticketing_links_event_id_connection_id_key;

alter table event_ticketing_links
  add constraint event_ticketing_links_event_connection_external_unique
  unique (event_id, connection_id, external_event_id);

comment on table event_ticketing_links is
  'Pivots an internal events.id to an external event id on the provider. Unique on (event_id, connection_id, external_event_id) so the same connection can list multiple external events for one dashboard event (e.g. phased sales).';
