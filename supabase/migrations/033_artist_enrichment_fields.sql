-- Migration 033 — Artist enrichment fields.
--
-- Adds the per-artist columns the Spotify + MusicBrainz enrichment
-- pipeline writes through (lib/enrichment/{spotify,musicbrainz,artist-merger}).
-- Existing columns (spotify_id, instagram_handle, genres, meta_page_id,
-- website, notes) are intentionally untouched — the merger writes
-- through them too, but their existing semantics (manually-entered or
-- inherited from earlier flows) stay valid.
--
-- All new columns are nullable, no defaults change behaviour for
-- existing rows. RLS is unchanged; the existing per-row owner policies
-- on `artists` already cover the additional columns.

alter table artists
  add column if not exists musicbrainz_id     text,
  add column if not exists facebook_page_url  text,
  add column if not exists tiktok_handle      text,
  add column if not exists soundcloud_url     text,
  add column if not exists beatport_url       text,
  add column if not exists bandcamp_url       text,
  add column if not exists profile_image_url  text,
  add column if not exists popularity_score   integer,
  -- Raw blended payload from the Spotify + MusicBrainz responses.
  -- Keeps the original shapes around so we can introspect debug
  -- mismatches and pull future fields without another migration.
  add column if not exists profile_jsonb      jsonb not null default '{}'::jsonb,
  add column if not exists enriched_at        timestamptz;

comment on column artists.musicbrainz_id is
  'MusicBrainz Artist MBID. Resolved by lib/enrichment/musicbrainz.ts when name match score crosses the threshold.';
comment on column artists.profile_jsonb is
  'Raw merged enrichment payload from Spotify + MusicBrainz. Inspectable for debug; new derived columns can be backfilled from this without a re-fetch.';
comment on column artists.enriched_at is
  'Timestamp of the last successful enrichment write. Null = never enriched (UI shows the "Enrich" button).';

notify pgrst, 'reload schema';
