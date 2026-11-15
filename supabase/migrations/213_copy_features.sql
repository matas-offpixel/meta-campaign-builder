-- Migration 213 — copy_features (learning layer: the shape of a copy line)
--
-- copy_performance (207) scores a line's words and no line yet runs in
-- two shows. This scores the line's shape instead: opener, call to
-- action, scarcity claim, length band, emoji band, lineup list, date,
-- price, line count. Every value is a label from a fixed list, so a
-- value recurs across shows the way a template key cannot yet.
--
-- One row per feature × value × field × stage × voice × scope. Same
-- maths as 207: index_vs_event is the shrunk expected ÷ actual against
-- the event's stage cost per result (client fallback under 10 results),
-- (n × index + 2) / (n + 2), n = distinct shows (the 208 rule). proven is
-- n ≥ 2 and ≤ 0.9. No example text: a label is not client copy, but the
-- table follows 207's RLS anyway — service role only.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent. Not applied from the branch.

create table if not exists copy_features (
  feature         text not null check (feature in (
                    'opener', 'cta_kind', 'scarcity_kind', 'length_band', 'emoji_count_band',
                    'has_lineup_list', 'has_date', 'has_price', 'line_count_band')),
  value           text not null,
  field           text not null check (field in ('body', 'title')),
  stage           text not null check (stage in ('registration', 'ticket_sale')),
  voice           text not null check (voice in ('promoter', 'artist', 'unknown')),
  scope           text not null check (scope in ('client', 'vertical', 'all')),
  scope_id        text not null,
  events_n        integer not null,
  ads_n           integer not null,
  spend           numeric not null,
  results         numeric not null,
  index_vs_event  numeric,
  confidence      text not null check (confidence in ('thin', 'ok', 'strong')),
  proven          boolean not null,
  client_ids      uuid[] not null default '{}',
  updated_at      timestamptz not null default now(),
  primary key (feature, value, field, stage, voice, scope, scope_id)
);

comment on table copy_features is
  'The shape of ad copy (opener, CTA, scarcity, length, emoji, list, date, price, lines) scored against the event it ran in. Labels only, no copy. Service role only. Migration 213.';
comment on column copy_features.value is
  'One label from the feature''s fixed list in lib/learning/copy/features.ts, e.g. cta_kind = sign_up.';
comment on column copy_features.index_vs_event is
  'Shrunk expected÷actual against the event stage cost per result. (n×index+2)/(n+2), n = shows. Below 1 is better.';
comment on column copy_features.events_n is
  'Distinct shows, the copy_performance rule: one ad counts toward one event; same date and venue are one show; cancelled and undated events are not shows.';
comment on column copy_features.proven is
  'n ≥ 2 shows and the shrunk index is 0.9 or lower.';

create index if not exists copy_features_scope_stage_idx
  on copy_features (scope, scope_id, stage, index_vs_event);

alter table copy_features enable row level security;

do $$
begin
  -- A policy of false, not the absence of a policy: a later grant of
  -- authenticated SELECT still matches nothing. No insert, update or
  -- delete policy, so authenticated cannot write either.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'copy_features'
      and policyname = 'copy_features no authenticated read'
  ) then
    execute
      'create policy "copy_features no authenticated read" '
      'on copy_features for select to authenticated using (false)';
  end if;
end $$;

notify pgrst, 'reload schema';
