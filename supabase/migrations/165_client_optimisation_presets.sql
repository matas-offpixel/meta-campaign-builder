-- Migration 165 — client_optimisation_presets + campaign_plans.target_*
--
-- PR 2 of 7, campaign creator redesign
-- (docs/CAMPAIGN_CREATOR_REDESIGN_2026-09-04.md §1 row 2, §2 zone D,
--  §5 rows 5/14, build sequence step 2).
--
-- Of the 14 Optimisation Strategy questions the wizard asks per campaign,
-- exactly ONE is per-campaign: the target. The other 13 (mode, metric,
-- window, the five ladder bands, action percents, and the six guardrails)
-- are client policy. They move here.
--
-- The preset is per CLIENT x OBJECTIVE, not per client:
-- `generateRulesForObjective` in lib/optimisation-rules.ts already keys on
-- CampaignObjective, and a signup ladder is not a sales ladder.
--
-- `objective` is the internal CampaignObjective
-- (purchase|registration|traffic|awareness|engagement) — the same key
-- `generateRulesForObjective` and `OBJECTIVE_METRIC_PRIORITY` take. It is
-- NOT an OptimisationGoal and never a Meta OUTCOME_* enum. The
-- OptimisationGoal a target unit implies is derived at materialise time by
-- lib/plan/target-unit.ts; storing it here would be a second key for the
-- same ladder.
--
-- Versioning: `version` is a monotonic counter, bumped on every save, and
-- there is exactly ONE live row per (client_id, objective) — see the unique
-- constraint. The immutable record of what version N actually contained is
-- the materialised `optimisationStrategy` jsonb on each campaign_drafts row
-- (which carries presetId + presetVersion + materialisedAt), not a history
-- table here. A published campaign therefore never changes when the preset
-- does.
--
-- Nothing in this file is read by lib/optimisation/evaluate.ts or
-- lib/optimisation/tick-runner.ts. The tick reads the campaign's own
-- materialised strategy exactly as it does today (§6 untouched); a
-- grep-guard test enforces the absence of that import.
--
-- RLS follows the campaign_drafts pattern: per-user, auth.uid() = user_id.
--
-- Foundation only. Apply manually after review. Do not apply in this run.

create table if not exists client_optimisation_presets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  client_id     uuid not null references clients (id) on delete cascade,
  objective     text not null
    check (objective in (
      'purchase',
      'registration',
      'traffic',
      'awareness',
      'engagement'
    )),
  version       int not null default 1
    check (version >= 1),
  default_arm   text not null default 'off'
    check (default_arm in ('off', 'shadow')),
  mode          text not null default 'benchmarks'
    check (mode in ('none', 'benchmarks', 'custom')),
  rules         jsonb not null default '[]'::jsonb,
  guardrails    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint client_optimisation_presets_client_objective_unique
    unique (client_id, objective)
);

comment on table client_optimisation_presets is
  'Client x objective optimisation policy — the 13 of 14 Optimisation Strategy fields that are not per-campaign. Materialised into campaign_drafts.draft_json->optimisationStrategy at draft creation / plan prepare; never read by the optimisation tick.';
comment on column client_optimisation_presets.objective is
  'Internal CampaignObjective (purchase|registration|traffic|awareness|engagement) — the key generateRulesForObjective takes. Not an OptimisationGoal, never a Meta OUTCOME_* enum.';
comment on column client_optimisation_presets.version is
  'Monotonic counter bumped on every save. Materialised strategies record presetVersion so preset drift is visible on a published campaign without mutating it.';
comment on column client_optimisation_presets.default_arm is
  'off | shadow only. The arm stays per campaign: live remains the explicit per-campaign gate (campaign_drafts.optimisation_automation_live + ENABLE_OPTIMISATION_WRITES). A preset can never arm live writes.';
comment on column client_optimisation_presets.rules is
  'PresetRule[] — metric, timeWindow, benchmarkTarget, and thresholds whose bands are MULTIPLIERS of the campaign target (not absolute currency). materialiseStrategy(preset, target) turns multipliers into the absolute OptimisationThreshold[] the evaluator reads.';
comment on column client_optimisation_presets.guardrails is
  'PresetGuardrails — maxExpansionPercent, ceilingBehaviour, maxSingleAdSetBudget(+Type), maxDailyIncreasePercent, cooldownHours. baseCampaignBudget / hardBudgetCeiling are NOT stored: both are derived from the campaign budget at materialise time.';

create index if not exists client_optimisation_presets_user_idx
  on client_optimisation_presets (user_id, updated_at desc);
create index if not exists client_optimisation_presets_client_idx
  on client_optimisation_presets (client_id);

alter table client_optimisation_presets enable row level security;

drop policy if exists "Users can manage their own client_optimisation_presets"
  on client_optimisation_presets;
create policy "Users can manage their own client_optimisation_presets"
  on client_optimisation_presets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists client_optimisation_presets_updated_at
  on client_optimisation_presets;
create trigger client_optimisation_presets_updated_at
  before update on client_optimisation_presets
  for each row execute procedure update_updated_at_column();

-- ── campaign_plans.target_* — zone D's one field ──────────────────────
--
-- The 14th Optimisation Strategy question, and the only one that belongs
-- on a campaign. The unit picks the objective and the ladder metric
-- (lib/plan/target-unit.ts); the value scales the preset's multiplier
-- bands. Both nullable: an existing plan has no target, and materialise
-- falls back to the preset's benchmarkTarget with provenance
-- "industry seed" when it is absent.
--
-- PR 3 renders this on the canvas as `◎ £1.20 / reg`.

alter table campaign_plans
  add column if not exists target_value numeric(12, 4)
    check (target_value is null or target_value > 0);

alter table campaign_plans
  add column if not exists target_unit text
    check (target_unit is null or target_unit in (
      'reg',
      'click',
      'lpv',
      'purchase',
      'view'
    ));

comment on column campaign_plans.target_value is
  'Zone D target, in the plan currency per one unit of target_unit (e.g. 1.20 = GBP 1.20 per registration). Null means no operator target — materialise falls back to the preset benchmarkTarget and marks provenance industry seed.';
comment on column campaign_plans.target_unit is
  'reg | click | lpv | purchase | view. Implies the CampaignObjective, the OptimisationGoal, and the ladder RuleMetric via lib/plan/target-unit.ts. Null alongside a null target_value.';

notify pgrst, 'reload schema';
