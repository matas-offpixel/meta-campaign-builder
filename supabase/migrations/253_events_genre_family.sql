-- 253: events.genre_family, one confirmed genre per show (design record
-- docs/design-record/2026-11-16-genre-key.html, GK1–GK2).
--
-- Additive only. Nullable, no default, no backfill: null is "Not set"
-- (nothing confirmed yet). 'no_single_genre' is a confirmed "none" for
-- multi-genre brand campaigns. Neither joins any genre.
--
-- The list is fixed. A new family is a new design record and a new
-- migration, never a free entry. Same keys, same order as
-- lib/learning/genre/families.ts (GENRE_FAMILIES).
--
-- Only an operator writes it, one event at a time, from the event form.
-- Learning-refresh reads it for the shadow genre rows (GK3); no reader
-- shows those rows yet.

alter table public.events
  add column if not exists genre_family text;

alter table public.events
  drop constraint if exists events_genre_family_check;

alter table public.events
  add constraint events_genre_family_check check (
    genre_family is null
    or genre_family in (
      'house_tech',
      'deep_afro',
      'melodic_prog',
      'disco',
      'garage_bass',
      'dnb',
      'techno',
      'hard_techno',
      'commercial',
      'no_single_genre'
    )
  );

comment on column public.events.genre_family is
  'One genre family per show, confirmed by an operator (GK1). Null = Not set. no_single_genre = a confirmed none. Fixed list; see lib/learning/genre/families.ts.';
