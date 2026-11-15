-- Migration 202 — Creative Lab M3d: cities an artist has played, any promoter.
--
-- Write only. Not applied from this branch. Claude applies it after merge.
-- Does not launch anything.

alter table creative_lab_artists
  add column if not exists played_cities text[] not null default '{}';

comment on column creative_lab_artists.played_cities is
  'cities the artist has played before, confirmed by the operator, any promoter.';
