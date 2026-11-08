-- Migration 212 — event_artists.source: where a lineup row came from.
--
-- Write only. Not applied from this branch. Matas applies it after merge.
-- 211 is the migration this follows.
--
-- The Lab writes event_artists from the lineup editor. The artist library
-- backfill (scripts/backfill-artists.mts) and the nightly artist_library
-- job in /api/cron/learning-refresh add rows recovered from the Lab
-- lineup facts, the event's own ad copy, and campaign / ad-set names, so
-- the copy normaliser can slot support acts as {artist}. The source says
-- which, so a recovered row is never mistaken for a curated one. Existing
-- rows are the Lab's.

alter table public.event_artists
  add column if not exists source text not null default 'lab';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'event_artists_source_check'
      and conrelid = 'public.event_artists'::regclass
  ) then
    alter table public.event_artists
      add constraint event_artists_source_check
      check (source in ('lab', 'lineup', 'ad_copy', 'campaign_name'));
  end if;
end $$;

comment on column public.event_artists.source is
  'lab: the Lab lineup editor. lineup: copied from creative_lab_event_facts.lineup. ad_copy: a name the event''s own ad copy carries, confirmed on Spotify. campaign_name: a name from a campaign or ad-set name, confirmed on Spotify. Migration 212.';

notify pgrst, 'reload schema';
