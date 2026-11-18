-- 261: creative test variant pairs (docs/design-record/2026-11-18-creative-test-variant-pairs.html, VP1).
--
-- A variant pair is a test of its own kind, 'pair': two versions of one asset
-- with one thing changed. Migration 255's check on creative_tests.kind allows
-- tracks, statics, together, copy and clip only, so this widens it. The old
-- values all stay. The pair's own kind (track, clip or card), its two windows,
-- its static, its sign-off and its artist-page approval sit in held (VP7).
--
-- Stored as 'pair', not 'tracks': a later Statics test takes the Tracks test's
-- winner as its winning track, and a pair's winner must never be read that way.
--
-- Additive. Unapplied: Matas applies it.

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.creative_tests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%(kind = any%'
  loop
    execute format('alter table public.creative_tests drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.creative_tests
  add constraint creative_tests_kind_check
  check (kind in ('tracks', 'statics', 'together', 'copy', 'clip', 'pair'));

comment on column public.creative_tests.kind is
  'CT6: what the test changes. pair (migration 261, VP1) is two versions of one asset; held.pair says which (track, clip or card).';

comment on column public.creative_tests.held is
  'CT6: what the test holds. A pair (VP1, VP7) also keeps its asset, its two windows, its sign-off and its artist-page approval here. Migrations 255 and 261.';
