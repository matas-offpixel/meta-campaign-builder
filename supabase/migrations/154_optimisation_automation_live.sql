-- Migration 154 — campaign_drafts.optimisation_automation_live (task #120, PR B)
--
-- PR A (migration 151) shipped shadow-mode recommendations only. PR B starts
-- issuing real Meta daily_budget writes, but ONLY when all three live gates
-- are open (mirror of D2C's shouldD2CDryRun):
--
--   a) env ENABLE_OPTIMISATION_WRITES === "1"
--   b) campaign_drafts.optimisation_automation_enabled = true  (existing)
--   c) campaign_drafts.optimisation_automation_live = true     (this column)
--
-- Default OFF. Setting it stays a deliberate SQL update per campaign until
-- PR C ships the campaign-detail-page toggle. Do NOT add a UI in this PR.
--
-- Apply via the Supabase MCP `apply_migration` before merge validation.

alter table campaign_drafts
  add column if not exists optimisation_automation_live boolean not null default false;

create index if not exists idx_campaign_drafts_optimisation_automation_live
  on campaign_drafts (optimisation_automation_live)
  where optimisation_automation_live = true;

comment on column campaign_drafts.optimisation_automation_live is
  'PR B live-write opt-in for the Step 6 automation cron (task #120). Default false. A write happens only when ENABLE_OPTIMISATION_WRITES=1 AND optimisation_automation_enabled AND this flag. Set via SQL until PR C ships the UI toggle. Migration 154.';

notify pgrst, 'reload schema';
