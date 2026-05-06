-- Migration 083 — Per-link API base override for 4TheFans multi-site clients.
--
-- One 4TheFans WordPress network can host events across multiple domains
-- (e.g. 4thefans.book.tickets and wearefootballfestival.book.tickets).
-- All sites share the same bearer token but have distinct wp-json base URLs.
--
-- Option A (chosen): per-link override stored on event_ticketing_links.
-- Sync logic reads: link.external_api_base ?? DEFAULT_API_BASE.
-- Already-linked events keep NULL → no behaviour change on the default site.
-- Manchester WC26 Depot Mayfield links get
--   external_api_base = 'https://wearefootballfestival.book.tickets/wp-json/agency/v1'
-- set via Supabase admin after deploy.

alter table event_ticketing_links
  add column if not exists external_api_base text;

comment on column event_ticketing_links.external_api_base is
  'Per-link 4TheFans API base URL override. When non-null the sync uses this base instead of the hardcoded DEFAULT_API_BASE. Allows one 4TheFans bearer token to serve multiple WordPress/WooCommerce booking sites (e.g. 4thefans.book.tickets and wearefootballfestival.book.tickets). NULL = use provider default.';

notify pgrst, 'reload schema';
