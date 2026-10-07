-- Migration 186 — tag_performance + interest_clusters live evidence
-- (learning loop B: stored learnings)
--
-- tag_performance: one row per scope × creative tag × funnel stage over a
-- rolling window, restated nightly by /api/cron/learning-refresh
-- (service role) from ad_daily_insights + creative_tag_assignments. Every
-- row carries its n (funded_ads, n_effective) and a confidence label, so
-- readers never rank thin evidence as if it were settled.
--
--   scope 'client'   scope_id = clients.id
--   scope 'vertical' scope_id = clients.vertical
--   scope 'all'      scope_id = 'all'
--
-- index = cpr ÷ baseline_cpr (below 1 beats the scope's norm).
-- shrunk_index pulls index toward pool_index by funded_ads
-- (lib/learning/shrink.ts). Spend and CPR are GBP.
--
-- interest_clusters.live_evidence: the nightly join of each saved cluster
-- to the ad sets that ran exactly its interests. evidence (the 6 Oct
-- offline snapshot) is left as it is.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent: if not exists + catalog-checked policies.

create table if not exists tag_performance (
  id                  uuid primary key default gen_random_uuid(),
  scope               text not null check (scope in ('client', 'vertical', 'all')),
  scope_id            text not null,
  dimension           text not null,
  value_key           text not null,
  stage               text not null check (stage in ('registration', 'ticket_sale', 'unknown')),
  window_days         integer not null default 90,
  ads                 integer not null default 0,
  funded_ads          integer not null default 0,
  spend               numeric not null default 0,
  impressions         bigint not null default 0,
  link_clicks         bigint not null default 0,
  landing_page_views  bigint not null default 0,
  video_plays_3s      bigint not null default 0,
  results             bigint not null default 0,
  cpr                 numeric,
  ctr                 numeric,
  baseline_cpr        numeric,
  "index"             numeric,
  pool_index          numeric,
  n_effective         numeric,
  shrunk_index        numeric,
  confidence          text not null check (confidence in ('thin', 'ok', 'strong')),
  computed_at         timestamptz not null default now(),
  constraint tag_performance_key unique (scope, scope_id, dimension, value_key, stage, window_days)
);

create index if not exists tag_performance_scope_stage_idx
  on tag_performance (scope, scope_id, stage);

comment on table tag_performance is
  'Learning loop B: per scope (client | vertical | all) × creative tag × stage over window_days, restated nightly by /api/cron/learning-refresh. Spend and CPR are GBP. Migration 186.';
comment on column tag_performance.funded_ads is
  'Ads carrying the tag with at least £5 spend in the scope, stage and window. The n of the shrinkage.';
comment on column tag_performance.baseline_cpr is
  'Median per-ad cost per result over every funded tagged ad in the scope and stage; an ad with no result counts as worst. Null when that median has no result.';
comment on column tag_performance."index" is
  'cpr ÷ baseline_cpr. Below 1 beats the scope''s norm.';
comment on column tag_performance.pool_index is
  'The index the row is shrunk toward: client → vertical (all when the vertical row is thin), vertical → all, all → 1.';
comment on column tag_performance.shrunk_index is
  '(funded_ads × index + 10 × pool_index) ÷ (funded_ads + 10). See lib/learning/shrink.ts.';
comment on column tag_performance.confidence is
  'thin: < 3 funded ads or < £150 spend. strong: ≥ 10 funded ads and ≥ £500. ok otherwise.';

alter table tag_performance enable row level security;

do $$
begin
  -- Writes are service-role only (no insert/update policy). Reads: the
  -- operator who owns the client, or for pooled rows any client in the
  -- pool. client_users own no clients, so they read nothing here.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tag_performance'
      and policyname = 'authenticated read own clients tag_performance'
  ) then
    execute
      'create policy "authenticated read own clients tag_performance" '
      'on tag_performance for select '
      'to authenticated using ('
      '  exists (select 1 from clients c where c.user_id = auth.uid() and ('
      '    (tag_performance.scope = ''client'' and c.id::text = tag_performance.scope_id) '
      '    or (tag_performance.scope = ''vertical'' and c.vertical = tag_performance.scope_id) '
      '    or tag_performance.scope = ''all'''
      '  ))'
      ')';
  end if;
end $$;

alter table interest_clusters
  add column if not exists evidence_refreshed_at timestamptz;

alter table interest_clusters
  add column if not exists live_evidence jsonb;

comment on column interest_clusters.live_evidence is
  'Nightly: launched_ad_sets with exactly these interest ids × ad_daily_insights, registration stage. adSets, fundedAdSets, spend (GBP), registrations, cpr, clients, cprIndex, confidence, perClient. evidence stays the offline snapshot. Migration 186.';
comment on column interest_clusters.evidence_refreshed_at is
  'When live_evidence was last written. Migration 186.';

notify pgrst, 'reload schema';
