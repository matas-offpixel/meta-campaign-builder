-- Migration 095 — Extend meta_custom_audiences.audience_subtype CHECK
--
-- The lookalike audience builder introduces a new audience_subtype value
-- ('lookalike') that the original 069 CHECK constraint (re-applied at 068c)
-- does not permit. Lookalike audiences are structurally different: they
-- reference an origin (seed) audience + a lookalike_spec instead of a rule.
-- All other lookalike-specific fields (origin_audience_id, ratio, country,
-- seedName) live inside the existing source_meta jsonb column — no other
-- schema changes are required.
--
-- This migration is purely additive: it programmatically drops any existing
-- CHECK constraint on audience_subtype (whatever its auto-generated name) and
-- replaces it with one that includes 'lookalike'. No data backfill is needed
-- (no existing rows can violate the extended CHECK).

do $$
declare
  cn text;
begin
  for cn in
    select conname
    from pg_constraint
    where conrelid = 'public.meta_custom_audiences'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%audience_subtype%'
  loop
    execute format(
      'alter table public.meta_custom_audiences drop constraint %I',
      cn
    );
  end loop;
end $$;

alter table meta_custom_audiences
  add constraint meta_custom_audiences_audience_subtype_check
  check (audience_subtype in (
    'page_engagement_fb',
    'page_engagement_ig',
    'page_followers_fb',
    'page_followers_ig',
    'video_views',
    'website_pixel',
    'lookalike'
  ));

notify pgrst, 'reload schema';
