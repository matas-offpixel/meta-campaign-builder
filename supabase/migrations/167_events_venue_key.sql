-- Migration 167 — events.venue_key (audit two §6 item 1; canon §1.2 amendment (2))
--
-- events.venue_id is null on every spend event. The only key is free-text
-- venue_name, and 4theFans spells one venue three ways. The ladder keys on
-- this normalised text until a real venues FK exists.
--
-- Normaliser (must match lib/plan/venue-key.ts): lower, trim, collapse
-- spaces, strip a leading "the ", strip a trailing city suffix from the
-- audit's spellings (birmingham, glasgow, leeds, islington).
-- Backfill is per-row; grouping is (client_id, venue_key).
--
-- Foundation only. Apply after review. Do not apply in this run.

alter table events
  add column if not exists venue_key text;

comment on column events.venue_key is
  'Normalised venue name for "at this venue" (lower, trimmed, city suffix stripped). Group with client_id.';

update events
set venue_key = nullif(
  trim(both from regexp_replace(
    regexp_replace(
      regexp_replace(lower(trim(venue_name)), '\s+', ' ', 'g'),
      '^the\s+',
      ''
    ),
    '\s+(birmingham|glasgow|leeds|islington)$',
    ''
  )),
  ''
)
where venue_name is not null
  and venue_key is null;

create index if not exists events_client_venue_key_idx
  on events (client_id, venue_key)
  where venue_key is not null;
