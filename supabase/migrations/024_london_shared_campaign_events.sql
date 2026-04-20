-- Migration 024 — Seed shared London campaign events for 4theFans (WC26).
--
-- Why a migration for what looks like data:
--   The portal's London spend logic (components/share/client-portal-venue-table.tsx)
--   reads two synthetic event rows by event_code:
--     WC26-LONDON-ONSALE   — shared on-sale campaign across all 4 London venues
--     WC26-LONDON-PRESALE  — shared presale campaign across 3 of the 4 venues
--   These rows are *required* by the new code path, so they belong in the
--   schema lifecycle alongside it. Idempotent INSERT means re-running the
--   migration locally is safe.
--
-- After applying:
--   1. The "Refresh all spend" button on the client overview will pick up
--      these new event_codes automatically and pull lifetime spend from
--      Meta into events.meta_spend_cached on the next click.
--   2. The portal's onsale-distribution logic activates as soon as the
--      WC26-LONDON-ONSALE row has a non-null meta_spend_cached value.
--   3. The portal hides these synthetic rows from the venue table — they
--      surface only as the "Overall London" aggregate header values.
--
-- Hard-coded user_id / client_id come from the task brief. Both already
-- exist (the user is the only seat on the account, the client is 4theFans).
-- The presence of the synthetic rows does not affect any other client
-- because the portal logic looks them up by event_code first.

insert into events (
  user_id,
  client_id,
  slug,
  name,
  event_code,
  venue_name,
  venue_city,
  status
)
values
  (
    'b3ee4e5c-44e6-4684-acf6-efefbecd5858',
    '37906506-56b7-4d58-ab62-1b042e2b561a',
    'wc26-london-onsale',
    'WC26 London On-Sale Campaign',
    'WC26-LONDON-ONSALE',
    'London',
    'London',
    'upcoming'
  ),
  (
    'b3ee4e5c-44e6-4684-acf6-efefbecd5858',
    '37906506-56b7-4d58-ab62-1b042e2b561a',
    'wc26-london-presale',
    'WC26 London Presale Campaign',
    'WC26-LONDON-PRESALE',
    'London',
    'London',
    'upcoming'
  )
on conflict (user_id, slug) do nothing;

notify pgrst, 'reload schema';
