-- Migration 164 — scope on campaign_automation_decisions (task #120 CBO)
--
-- Distinguishes campaign-level CBO decisions from per-ad-set ABO rows.
-- campaign_id already stores the Meta campaign id; adset_id stays NOT NULL
-- (CBO rows reuse the campaign id there so the existing
-- idx_cad_adset_decided cooldown still keys one target). scope is the
-- honest discriminator for the #857 glyph and for apply.ts targeting.
--
-- Apply manually after review. Do not apply in this run.

alter table campaign_automation_decisions
  add column if not exists scope text not null default 'ad_set';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaign_automation_decisions_scope_check'
  ) then
    alter table campaign_automation_decisions
      add constraint campaign_automation_decisions_scope_check
      check (scope in ('ad_set', 'campaign'));
  end if;
end $$;

comment on column campaign_automation_decisions.scope is
  'Target object for the decision. Default ad_set — pre-164 rows are ad-set evaluations. campaign means CBO: apply.ts writes campaign daily_budget, not ad-set budgets.';

notify pgrst, 'reload schema';
