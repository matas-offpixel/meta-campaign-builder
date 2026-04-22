-- Migration 034 — Venue enrichment fields.
--
-- Adds Google Places (New) enrichment columns to `venues` so the
-- venue slide-over can one-click populate the canonical address,
-- coords, phone, rating, and a small set of map-display fields.
--
-- All new columns are nullable, no defaults change behaviour for
-- existing rows. RLS untouched — the existing per-row owner policies
-- on `venues` already cover the additional columns.
--
-- The unique partial index on (user_id, google_place_id) prevents
-- the same Google Place from being attached to two of one user's
-- venue records (Matas accidentally enriching the same venue twice
-- under different names) without forbidding NULL place IDs on rows
-- that haven't been enriched yet.

alter table venues
  add column if not exists google_place_id    text,
  add column if not exists latitude           double precision,
  add column if not exists longitude          double precision,
  add column if not exists phone              text,
  add column if not exists address_full       text,
  add column if not exists google_maps_url    text,
  add column if not exists rating             numeric(2,1),
  add column if not exists user_ratings_total integer,
  add column if not exists photo_reference    text,
  add column if not exists profile_jsonb      jsonb not null default '{}'::jsonb,
  add column if not exists enriched_at        timestamptz;

create unique index if not exists venues_google_place_id_user_idx
  on venues (user_id, google_place_id)
  where google_place_id is not null;

comment on column venues.google_place_id is
  'Google Places (New) ID. Persisted so re-enrich can hit /places/{id} directly instead of re-running searchText.';
comment on column venues.profile_jsonb is
  'Raw Google Places payload. Inspectable for debug; new derived columns can be backfilled from this without a re-fetch.';
comment on column venues.enriched_at is
  'Timestamp of the last successful enrichment write. Null = never enriched (UI shows the "Enrich" button).';

notify pgrst, 'reload schema';
