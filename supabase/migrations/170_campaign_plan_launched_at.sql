-- Migration 170 — campaign_plan_*_launch.launched_at
--
-- planLaunchStamp used to read created_at, which is written at prepare-draft
-- (D.O.D: 26 Aug 13:51 UTC). That is not the launch. launched_at is written
-- once on the transition to live and never overwritten.
--
-- Backfill: live rows with launched_at null take the plan window start
-- (start_date + start_time, Europe/London). launched_at_source = plan_start
-- so the header ⓘ can say "launch time taken from the plan's start".
-- New live writes use launched_at_source = ledger.
--
-- Foundation only. Apply after review (after 169). Do not apply in this run.

alter table campaign_plan_meta_launch
  add column if not exists launched_at timestamptz,
  add column if not exists launched_at_source text
    check (launched_at_source is null or launched_at_source in ('ledger', 'plan_start'));

alter table campaign_plan_tiktok_launch
  add column if not exists launched_at timestamptz,
  add column if not exists launched_at_source text
    check (launched_at_source is null or launched_at_source in ('ledger', 'plan_start'));

alter table campaign_plan_google_launch
  add column if not exists launched_at timestamptz,
  add column if not exists launched_at_source text
    check (launched_at_source is null or launched_at_source in ('ledger', 'plan_start'));

comment on column campaign_plan_meta_launch.launched_at is
  'When the adapter went live. Written once; created_at is prepare-draft and is never a launch time.';
comment on column campaign_plan_meta_launch.launched_at_source is
  'ledger = written at the live upsert. plan_start = backfilled from campaign_plans window start.';

update campaign_plan_meta_launch l
set
  launched_at = ((p.start_date + coalesce(p.start_time, time '00:00')) at time zone 'Europe/London'),
  launched_at_source = 'plan_start'
from campaign_plans p
where l.plan_id = p.id
  and l.status = 'live'
  and l.launched_at is null
  and p.start_date is not null;

update campaign_plan_tiktok_launch l
set
  launched_at = ((p.start_date + coalesce(p.start_time, time '00:00')) at time zone 'Europe/London'),
  launched_at_source = 'plan_start'
from campaign_plans p
where l.plan_id = p.id
  and l.status = 'live'
  and l.launched_at is null
  and p.start_date is not null;

update campaign_plan_google_launch l
set
  launched_at = ((p.start_date + coalesce(p.start_time, time '00:00')) at time zone 'Europe/London'),
  launched_at_source = 'plan_start'
from campaign_plans p
where l.plan_id = p.id
  and l.status = 'live'
  and l.launched_at is null
  and p.start_date is not null;

notify pgrst, 'reload schema';
