-- Migration 162 — channel on campaign_automation_decisions (M.4 cross-channel shadow)
--
-- One rule set (the linked Meta draft's Optimisation Strategy), three
-- shadow ledgers. Existing rows are Meta by definition — the default
-- makes this backfill-free. Cross-channel inserts in this PR are always
-- dry_run=true / applied=false; per-channel Live arming is a named
-- follow-up and is not gated here.
--
-- Apply manually after review. Do not apply in this run.

alter table campaign_automation_decisions
  add column if not exists channel text not null default 'meta';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaign_automation_decisions_channel_check'
  ) then
    alter table campaign_automation_decisions
      add constraint campaign_automation_decisions_channel_check
      check (channel in ('meta', 'tiktok', 'google'));
  end if;
end $$;

create index if not exists idx_cad_channel_decided
  on campaign_automation_decisions (channel, decided_at desc);

comment on column campaign_automation_decisions.channel is
  'Ledger channel for the Optimisation Strategy evaluator. Default meta — pre-162 rows are Meta by definition. TikTok/Google rows in M.4 are shadow-only (dry_run=true, applied=false) regardless of the Meta arming level. Per-channel Live arming is a named follow-up.';

notify pgrst, 'reload schema';
