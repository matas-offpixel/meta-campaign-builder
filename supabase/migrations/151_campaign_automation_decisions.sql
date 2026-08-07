-- Migration 151 — campaign_automation_decisions (task #120, PR A: dry-run evaluator)
--
-- The wizard's Step 6 "Optimisation Strategy" section has always been a dead
-- end: rules + guardrails persist to `campaign_drafts.draft_json` and nothing
-- ever reads them again. No cron, no evaluator, no Meta write — an empty
-- promise in the operator's words. This migration is the backing store for
-- PR A: a scheduled evaluator that runs in SHADOW MODE ONLY. It reads live
-- Meta insights, runs the exact rule/guardrail logic PR B will eventually use
-- to write to Meta, and logs what it WOULD have done. Zero Meta writes.
-- `dry_run` is hard-coded true and `applied` hard-coded false at every insert
-- in PR A — those columns exist now so PR B is an additive change (start
-- writing `applied = true` rows / a `meta_response_json` payload) rather than
-- a schema migration on top of a schema migration.
--
-- Loop-prevention note: the cron checks `decided_at > now() - interval '24
-- hours'` per ad set BEFORE evaluating (see idx_cad_adset_decided) so an ad
-- set gets at most one decision row per 24h even in dry-run tracking —
-- mirrors the cadence PR B will actually run at, so the shadow log is a
-- realistic preview, not a 6×/day flood of the same recommendation.
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: `if not exists` + catalog-checked DO blocks throughout.

create table if not exists campaign_automation_decisions (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        text not null,          -- Meta campaign id (CampaignDraft.metaCampaignId)
  adset_id           text not null,          -- Meta ad set id (LaunchSummary.adSetsCreated[].metaAdSetId)
  ad_account_id      text not null,          -- act_-prefixed, matches campaign_drafts.ad_account_id
  draft_id           uuid references campaign_drafts(id) on delete set null,
  metric             text not null,          -- 'cpr' | 'cpc' | 'cpm' | 'ctr' | 'cpa' | 'lpv_cost' (RuleMetric)
  metric_value       numeric,                -- e.g. 2.35 (major currency units, e.g. £)
  metric_window      text not null,          -- '24h' | '3d' | '7d' (RuleTimeWindow)
  rule_matched       text,                   -- e.g. a threshold's `label`, or null if no band matched
  action_recommended text not null,          -- 'scale_up' | 'scale_down' | 'pause' | 'maintain' | 'skip_dormant' | 'skip_recent_touch'
  action_delta       numeric,                -- +30 (%), -25 (%), 0 for maintain, null for pause/skip
  budget_before_pence integer not null,      -- current daily_budget, Meta minor units
  budget_after_pence  integer not null,      -- what we WOULD set — equals budget_before_pence when not scaling
  guardrail_note     text,                   -- 'hit_hard_ceiling' | 'capped_by_max_expansion' | null
  reason_text        text,                   -- human-readable summary, see lib/optimisation/evaluate.ts
  dry_run            boolean not null default true,   -- always true in PR A — PR B starts setting this per-campaign
  applied            boolean not null default false,  -- always false in PR A — PR B flips true on a successful Meta write
  meta_response_json jsonb,                  -- null in PR A — PR B stores the update-ad-set response here
  decided_at         timestamptz not null default now(),
  applied_at         timestamptz
);

create index if not exists idx_cad_campaign_decided
  on campaign_automation_decisions (campaign_id, decided_at desc);

create index if not exists idx_cad_adset_decided
  on campaign_automation_decisions (adset_id, decided_at desc);

-- ── Opt-in flag ───────────────────────────────────────────────────────────
-- Default OFF. The PR A cron only evaluates campaigns explicitly opted in —
-- toggled via Supabase directly for now (`update campaign_drafts set
-- optimisation_automation_enabled = true where id = '<draft id>'`); PR C adds
-- the campaign-detail-page checkbox. A real column (not a draft_json key) so
-- the cron's eligibility query is a plain indexed boolean filter, not a JSONB
-- cast.
alter table campaign_drafts
  add column if not exists optimisation_automation_enabled boolean not null default false;

create index if not exists idx_campaign_drafts_optimisation_automation_enabled
  on campaign_drafts (optimisation_automation_enabled)
  where optimisation_automation_enabled = true;

-- ── RLS — authenticated read, service-role write ─────────────────────────
-- Same posture as migration 124 (cron_health_reports): this is operator
-- audit/dashboard data, not per-user scoped, and PR C's audit-log UI tab will
-- read it under a normal authenticated session. Only the service-role cron
-- (bypasses RLS) can insert — no write policy is defined on purpose.
alter table campaign_automation_decisions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'campaign_automation_decisions'
      and policyname = 'authenticated read campaign automation decisions'
  ) then
    execute
      'create policy "authenticated read campaign automation decisions" '
      'on campaign_automation_decisions for select '
      'to authenticated using (true)';
  end if;
end $$;

comment on table campaign_automation_decisions is
  'Shadow-mode (PR A) and eventually live (PR B) audit trail for the Step 6 Optimisation Strategy automation loop (task #120). One row per evaluated ad set per tick that was not skipped by the 24h loop-prevention window. dry_run/applied are hard-coded true/false in PR A — no Meta writes happen yet. Migration 151.';
comment on column campaign_drafts.optimisation_automation_enabled is
  'Opt-in flag for the Step 6 automation cron (task #120 PR A). Default false. Set via Supabase directly until PR C ships the campaign-detail-page toggle. When true AND status=''published'', /api/cron/optimisation-tick evaluates this campaign''s ad sets every 4h (still dry-run only — see ENABLE_OPTIMISATION_AUTOMATION in CLAUDE.md for the separate app-wide killswitch).';

notify pgrst, 'reload schema';
