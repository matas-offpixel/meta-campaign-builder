-- Migration 207 — copy_performance (learning layer: copy templates)
--
-- One row per template × field × stage × voice × scope. example_text is
-- a real line from a client's ad, so authenticated SELECT matches nothing.
-- The service role bypasses RLS. The learning-refresh cron is the writer.
--
-- index_vs_event is the shrunk index against the event's own stage cost
-- per result (client fallback under 10 results). Below 1 is better.
-- Shrinkage is (n × index + 2) / (n + 2), n = distinct events.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent. This migration is not applied from the branch.

create table if not exists copy_performance (
  template_key    text not null,
  field           text not null check (field in ('body', 'title')),
  stage           text not null check (stage in ('registration', 'ticket_sale')),
  voice           text not null check (voice in ('promoter', 'artist', 'unknown')),
  scope           text not null check (scope in ('client', 'vertical', 'all')),
  scope_id        text not null,
  example_text    text not null,
  events_n        integer not null,
  ads_n           integer not null,
  spend           numeric not null,
  results         numeric not null,
  index_vs_event  numeric,
  confidence      text not null check (confidence in ('thin', 'ok', 'strong')),
  proven          boolean not null,
  client_ids      uuid[] not null default '{}',
  page_id         text,
  updated_at      timestamptz not null default now(),
  primary key (template_key, field, stage, voice, scope, scope_id)
);

comment on table copy_performance is
  'Normalised ad copy scored against the event it ran in. No authenticated read: example_text is client ad copy. Service role only.';
comment on column copy_performance.index_vs_event is
  'Shrunk expected÷actual against the event stage cost per result. (n×index+2)/(n+2), n = events. Below 1 is better.';
comment on column copy_performance.proven is
  'n ≥ 2 events and the shrunk index is 0.9 or lower.';
comment on column copy_performance.example_text is
  'One real line, from the event where this template did best.';
comment on column copy_performance.page_id is
  'Page that posted the example. A client promoter page (default pages, or the page on a launched draft) is voice promoter. Any other page is an artist page and is kept here. Null only when the ad has no page id.';
comment on column copy_performance.events_n is
  'Distinct shows. One ad counts toward one event. Same date and venue are one show. Cancelled events, and events with no date, are not shows.';

create index if not exists copy_performance_scope_stage_idx
  on copy_performance (scope, scope_id, stage, index_vs_event);

alter table copy_performance enable row level security;

do $$
begin
  -- A policy of false, not the absence of a policy: a later grant of
  -- authenticated SELECT still matches nothing. No insert, update or
  -- delete policy, so authenticated cannot write either.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'copy_performance'
      and policyname = 'copy_performance no authenticated read'
  ) then
    execute
      'create policy "copy_performance no authenticated read" '
      'on copy_performance for select to authenticated using (false)';
  end if;
end $$;

notify pgrst, 'reload schema';
