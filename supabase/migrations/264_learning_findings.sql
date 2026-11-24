-- Migration 264 — learning_findings (the learnings engine's one store)
--
-- North Star issue 3 (docs/design-record/2026-11-23-north-star-3.html), RP1
-- onwards. The engine learns from what actually ran on Meta
-- (ad_daily_insights + campaign, ad set and ad names), not only from what
-- the app made. Every conclusion it draws is one row here:
--
--   test_verdict  E1 / RP1: an observed test's call (TF2 + TF5 on TF9's
--                 cadence), one row per ad set. PR1a writes it.
--   variant_pair  E2: two ads of one ad set differing on one axis. PR1b.
--   phase_curve   E2b: a show's cost per stage result per rollout phase. PR1b.
--   axis_rollup   E3: pairs and curves pooled across shows. PR1c.
--   show_week     E4: a show's week against the week before. PR1c.
--   copy_rule     E5: copy_features rows worth saying. PR1c.
--
-- All six kinds exist from here, so 1b and 1c need no migration.
--
-- One row per (kind, scope, scope_id, stage, week_start, subject): each
-- writer upserts on it, so a rerun replaces its rows. NULLS NOT DISTINCT
-- (Postgres 15+; prod is 17), so a row with no scope_id is still one row.
--
-- Operator-only (OP10, cross-client knowledge stays internal): service role
-- reads and writes; authenticated reads nothing, the same as copy_features
-- (213). The operator gate is the app reader's, on the OPERATOR_USER_IDS
-- env list (lib/learning/cross-client's requireOperator), which Postgres
-- cannot see. Share links and /admin/[clientSlug] never read this table
-- (lib/learning/__tests__/cross-client-guard.test.ts).
--
-- Apply by hand: prod first, then CI, only when the PR is about to merge.
-- Idempotent. Not applied from the branch.

create table if not exists learning_findings (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in (
                    'test_verdict', 'variant_pair', 'phase_curve', 'axis_rollup', 'show_week', 'copy_rule')),
  scope           text not null check (scope in ('event', 'client', 'vertical', 'all')),
  scope_id        text,
  event_id        uuid,
  client_id       uuid,
  stage           text,
  week_start      date,
  subject         text,
  metric          text,
  value_a         numeric,
  value_b         numeric,
  ratio           numeric,
  n_shows         integer,
  n_pairs         integer,
  spend_gbp       numeric,
  results         numeric,
  confidence      text check (confidence in ('thin', 'ok', 'strong')),
  verdict         text,
  read_day        smallint,
  source          text,
  evidence        jsonb not null default '{}'::jsonb,
  recommendation  jsonb,
  computed_at     timestamptz not null default now(),
  constraint learning_findings_key unique nulls not distinct (kind, scope, scope_id, stage, week_start, subject)
);

comment on table learning_findings is
  'The learnings engine''s findings: observed test verdicts, variant pairs, phase curves, cross-show rollups, show weeks, copy rules. Operator-only: service role only, the app reader gates on OPERATOR_USER_IDS. Migration 264.';
comment on column learning_findings.scope_id is
  'The scope''s key: the event code for scope event, the client id for client, the vertical for vertical, null for all.';
comment on column learning_findings.subject is
  'What the finding is about, unique within its kind and scope: the Meta ad set id for a test_verdict.';
comment on column learning_findings.week_start is
  'Monday of the London week the finding belongs to. For a test_verdict, its first delivery''s week, so each later read replaces the row.';
comment on column learning_findings.verdict is
  'The call''s state key (test_verdict: one_variant, no_result_event, running, meta_favours, ready_to_call, no_clear_winner, not_enough_variants, extended, stopped). The words are evidence.text.';
comment on column learning_findings.read_day is
  'Days from first delivery to the read (test_verdict): 4, 8 and 12 are TF9''s end days.';
comment on column learning_findings.source is
  'Exploration source tag (OP7): which house rule a test breaks on purpose, when it does. Null otherwise.';
comment on column learning_findings.evidence is
  'Everything the finding rests on: figures, benchmark, words, and for a test_verdict the state between reads (extensions, day-4 / day-8 marks).';

create index if not exists learning_findings_kind_event_idx
  on learning_findings (kind, event_id, computed_at desc);
create index if not exists learning_findings_kind_client_idx
  on learning_findings (kind, client_id, week_start desc);

alter table learning_findings enable row level security;

do $$
begin
  -- A policy of false, not the absence of a policy: a later grant of
  -- authenticated SELECT still matches nothing. No insert, update or
  -- delete policy, so authenticated cannot write either.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'learning_findings'
      and policyname = 'learning_findings no authenticated read'
  ) then
    execute
      'create policy "learning_findings no authenticated read" '
      'on learning_findings for select to authenticated using (false)';
  end if;
end $$;

notify pgrst, 'reload schema';
