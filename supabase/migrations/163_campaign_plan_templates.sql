-- Migration 163 — campaign_plan_templates
--
-- Plan templates store SHAPE only: objective, daily split, schedule
-- offsets relative to the event, optional destination pattern.
-- They must diverge from live campaign_plans rows:
--   - campaign_plans.event_id is NOT NULL and ON DELETE CASCADE
--   - launch children + asset routes CASCADE from campaign_plans
--   - status has no `template` value; a flag would be a second axis
--   - templates need description + tags (campaign_plans has neither)
-- Precedent: campaign_templates and tiktok_campaign_templates are
-- sibling tables, never a flag on the live row.
--
-- Foundation only. Apply manually after review. Do not apply in this run.

create table if not exists campaign_plan_templates (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  description    text not null default '',
  tags           text[] not null default '{}',
  snapshot_json  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table campaign_plan_templates is
  'Reusable plan shape. No event_id, no status, no launch FKs. snapshot_json is CampaignPlanTemplateSnapshot.';

create index if not exists campaign_plan_templates_user_updated_idx
  on campaign_plan_templates (user_id, updated_at desc);

alter table campaign_plan_templates enable row level security;

drop policy if exists "Users can manage their own campaign_plan_templates"
  on campaign_plan_templates;
create policy "Users can manage their own campaign_plan_templates"
  on campaign_plan_templates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists campaign_plan_templates_updated_at on campaign_plan_templates;
create trigger campaign_plan_templates_updated_at
  before update on campaign_plan_templates
  for each row execute procedure update_updated_at_column();

notify pgrst, 'reload schema';
