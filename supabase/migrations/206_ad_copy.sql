-- Migration 206 — ad_copy (learning layer: per-ad copy)
--
-- One row per Meta ad. The text is a client's live ad copy, so no
-- authenticated role can read it. The service role bypasses RLS and is
-- the only writer (the ad-daily-insights cron and the backfill script).
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent.

create table if not exists ad_copy (
  meta_ad_id                text primary key,
  ad_account_id             text not null,
  creative_id               text,
  bodies                    text[] not null default '{}',
  titles                    text[] not null default '{}',
  descriptions              text[] not null default '{}',
  link_caption              text,
  call_to_action            text,
  effective_object_story_id text,
  source                    text not null check (source in ('graph', 'lab', 'snapshot', 'draft')),
  fetched_at                timestamptz not null default now()
);

comment on table ad_copy is
  'Copy the ad ran. No authenticated read: rows hold client ad text. Service role only.';
comment on column ad_copy.bodies is
  'Every body variant: creative.body, object_story_spec messages, and each asset_feed_spec.bodies entry.';
comment on column ad_copy.titles is
  'Every title variant: creative.title, object_story_spec names, and each asset_feed_spec.titles entry.';
comment on column ad_copy.descriptions is
  'Every description variant, including each asset_feed_spec.descriptions entry.';
comment on column ad_copy.source is
  'graph is a creative read. lab, snapshot and draft only fill an ad that has no row, and never replace graph.';
comment on column ad_copy.fetched_at is
  'When this row was written. A graph row older than 30 days is read again.';

create index if not exists ad_copy_account_fetched_idx
  on ad_copy (ad_account_id, fetched_at);

alter table ad_copy enable row level security;

do $$
begin
  -- A policy of false, not the absence of a policy: a later grant of
  -- authenticated SELECT still matches nothing. No insert, update or
  -- delete policy, so authenticated cannot write either.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ad_copy'
      and policyname = 'ad_copy no authenticated read'
  ) then
    execute
      'create policy "ad_copy no authenticated read" '
      'on ad_copy for select to authenticated using (false)';
  end if;
end $$;

notify pgrst, 'reload schema';
