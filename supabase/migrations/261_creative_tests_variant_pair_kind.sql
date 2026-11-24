-- 261: creative test variant pairs, and a winner that has to beat the show.
--
-- docs/design-record/2026-11-18-creative-test-variant-pairs.html (VP1) and
-- docs/design-record/2026-11-18-creative-testing-6.html (TF5, TF6).
--
-- 1. A variant pair is a test of its own kind, 'pair': two versions of one
--    asset with one thing changed. Migration 255's check on creative_tests.kind
--    allows tracks, statics, together, copy and clip only, so this widens it.
--    The pair's own kind (track, clip or card), its two windows, its static, its
--    sign-off and its artist-page approval sit in held (VP7). Stored as 'pair',
--    not 'tracks': a later Statics test takes the Tracks test's winner as its
--    winning track, and a pair's winner must never be read that way.
-- 2. TF5: each daily read keeps the show's benchmark, its main-campaign cost per
--    result over the test's days (null with none), and the spend and results it
--    came from.
-- 3. TF6: a test is extended at most twice, by 4 days each; it keeps how many
--    times, and the figures at the reads that extended it (day 4's for the
--    improvement test, day 8's for the second). A test stopped above the show's
--    benchmark is 'stopped', so 255's state check is widened too.
--
-- Additive: every old kind and state stays; new columns only. Unapplied: Matas
-- applies it.

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.creative_tests'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%(kind = any%' or pg_get_constraintdef(oid) ilike '%(state = any%')
  loop
    execute format('alter table public.creative_tests drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.creative_tests
  add constraint creative_tests_kind_check
  check (kind in ('tracks', 'statics', 'together', 'copy', 'clip', 'pair'));

alter table public.creative_tests
  add constraint creative_tests_state_check
  check (state in ('waiting', 'making', 'approved', 'running', 'called', 'no_clear_winner', 'not_enough_variants', 'ended', 'stopped'));

alter table public.creative_tests
  add column if not exists extensions smallint not null default 0 check (extensions between 0 and 2),
  add column if not exists extension_evidence jsonb;

alter table public.creative_test_reads
  add column if not exists benchmark_cost numeric(12, 4),
  add column if not exists benchmark_spend numeric(12, 2),
  add column if not exists benchmark_results numeric(12, 2);

comment on column public.creative_tests.kind is
  'CT6: what the test changes. pair (migration 261, VP1) is two versions of one asset; held.pair says which (track, clip or card).';

comment on column public.creative_tests.held is
  'CT6: what the test holds. A pair (VP1, VP7) also keeps its asset, its two windows, its sign-off and its artist-page approval here. Migrations 255 and 261.';

comment on column public.creative_tests.extensions is
  'TF6: how many times the test was extended by 4 days because every variant was above the show''s benchmark (0, 1 or 2; 12 days at the most). Migration 261.';

comment on column public.creative_tests.extension_evidence is
  'TF6: each variant''s cost and results at the read that extended it ({day4, day8, second, capStoppedAt}). Migration 261.';

comment on column public.creative_test_reads.benchmark_cost is
  'TF5: the show''s main-campaign cost per result on the test''s event over the test''s days, at this read; null when the main campaign had no results. Migration 261.';
