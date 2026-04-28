-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 050 — Ticketing provider extensions.
--
-- Extends `client_ticketing_connections.provider` so it can hold
-- operator-driven sources alongside the existing API-backed providers:
--
--   - 'manual'                — operator types ticket counts via the
--                               /events/[id]/manual-tickets grid. No
--                               credentials, no cron sync.
--   - 'foursomething_internal'— placeholder for the 4theFans internal
--                               API once their adapter lands. Lets us
--                               gate UI state ("API connection
--                               pending") without a second migration
--                               when the provider flips on.
--
-- Migration 029 defined `provider` as a text column with a CHECK
-- constraint (not a Postgres enum). Extending is therefore a matter
-- of dropping + re-adding the constraint — no `ALTER TYPE` needed
-- and no risk of stuck enum values.
--
-- Safe to re-run: the `drop constraint if exists` + `add constraint`
-- pattern is idempotent for repeat supabase migrate runs.
-- ─────────────────────────────────────────────────────────────────────────────

alter table client_ticketing_connections
  drop constraint if exists client_ticketing_connections_provider_check;

alter table client_ticketing_connections
  add constraint client_ticketing_connections_provider_check
  check (
    provider in (
      'eventbrite',
      'fourthefans',
      'foursomething_internal',
      'manual'
    )
  );

comment on column client_ticketing_connections.provider is
  'Ticketing source. eventbrite = cron sync via personal token. fourthefans = legacy name for the 4theFans adapter (existing rows). foursomething_internal = 4theFans internal API once wired. manual = operator types cumulative tickets into the /events/[id]/manual-tickets grid; credentials column stays {} and last_synced_at stays null because there is no upstream API to poll.';

notify pgrst, 'reload schema';
