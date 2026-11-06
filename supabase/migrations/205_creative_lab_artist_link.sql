-- Migration 205 — Creative Lab M5: clearance belongs to the library artist.
--
-- Write only. Not applied from this branch. Claude applies it after merge.
-- One Lab row per client and library artist, so a tick for Puzzle carries
-- to Puzzle's next show. Null until the lineup links them.

alter table creative_lab_artists
  add column if not exists artist_id uuid references public.artists (id) on delete set null;

create unique index if not exists creative_lab_artists_client_artist_unique
  on creative_lab_artists (client_id, artist_id)
  where artist_id is not null;

comment on column creative_lab_artists.artist_id is
  'Library artist this clearance belongs to. One Lab row per client and library artist. Null until the lineup links them.';
