-- Migration 157 — campaign_plans (Phase D.1)
--
-- Platform-neutral launch intent. Plans do NOT store a platform enum
-- (v1 design decision 2). Per-adapter daily splits and launch outcomes
-- are named columns / 1:1 child tables, not a generic platform list.
--
-- Prior art read before this file:
--   - google_search_plans (096) — live Google plan + partial-success status
--   - google_ad_plans (017, legacy) — total + this-platform share
--   - ad_plans (005) — per-user RLS, event_id, landing_page_url
--   - campaign_drafts — per-user RLS (auth.uid() = user_id)
--   - audience clusters are ClusterLabel strings (lib/interest-suggestions.ts),
--     not a table — audience_cluster_ref is text, no FK
--
-- Foundation only. Apply manually after review. Do not apply in this run.

create table if not exists campaign_plans (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users (id) on delete cascade,
  event_id                   uuid not null references events (id) on delete cascade,
  name                       text,
  status                     text not null default 'draft'
    check (status in (
      'draft',
      'launching',
      'live_partial',
      'live',
      'failed',
      'archived'
    )),
  objective_intent           text not null
    check (objective_intent in (
      'purchase',
      'registration',
      'traffic',
      'awareness',
      'engagement'
    )),
  total_daily_budget         numeric(12, 2) not null default 0
    check (total_daily_budget >= 0),
  daily_budget_meta          numeric(12, 2) not null default 0
    check (daily_budget_meta >= 0),
  daily_budget_tiktok        numeric(12, 2) not null default 0
    check (daily_budget_tiktok >= 0),
  daily_budget_google        numeric(12, 2) not null default 0
    check (daily_budget_google >= 0),
  destination_url            text not null,
  audience_cluster_ref       text,
  creative_set_ref           text,
  start_date                 date,
  end_date                   date,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint campaign_plans_dates_check
    check (end_date is null or start_date is null or end_date >= start_date)
);

comment on table campaign_plans is
  'Platform-neutral multichannel launch intent. Adapters (D.2) map this row to existing Meta / TikTok / Google draft shapes. No platform enum column.';
comment on column campaign_plans.objective_intent is
  'Internal CampaignObjective (purchase|registration|traffic|awareness|engagement) — never a Meta OUTCOME_* / TikTok / Google enum.';
comment on column campaign_plans.destination_url is
  'Any URL (v2.1). Event LP when one exists; otherwise the operator-pasted destination.';
comment on column campaign_plans.audience_cluster_ref is
  'Opaque cluster label (e.g. Music & Nightlife from lib/interest-suggestions ClusterLabel). Not a FK — there is no audience_clusters table.';
comment on column campaign_plans.creative_set_ref is
  'Opaque creative-set reference. Not a FK — there is no creative_sets table.';
comment on column campaign_plans.status is
  'draft | launching | live_partial | live | failed | archived. live_partial is first-class: at least one adapter live and at least one failed.';

create index if not exists campaign_plans_user_updated_idx
  on campaign_plans (user_id, updated_at desc);
create index if not exists campaign_plans_event_idx
  on campaign_plans (event_id);
create index if not exists campaign_plans_status_idx
  on campaign_plans (status);

alter table campaign_plans enable row level security;

drop policy if exists "Users can manage their own campaign_plans" on campaign_plans;
create policy "Users can manage their own campaign_plans"
  on campaign_plans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists campaign_plans_updated_at on campaign_plans;
create trigger campaign_plans_updated_at
  before update on campaign_plans
  for each row execute procedure update_updated_at_column();

-- ── Per-adapter launch outcomes (no platform enum column) ─────────────
-- One 1:1 child table per adapter. Table identity is the adapter.
-- Missing child row = idle (not yet attempted).

create table if not exists campaign_plan_meta_launch (
  plan_id              uuid primary key references campaign_plans (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  draft_id             uuid references campaign_drafts (id) on delete set null,
  platform_campaign_id text,
  status               text not null default 'idle'
    check (status in ('idle', 'launching', 'live', 'failed', 'skipped')),
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists campaign_plan_tiktok_launch (
  plan_id              uuid primary key references campaign_plans (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  draft_id             uuid references tiktok_campaign_drafts (id) on delete set null,
  platform_campaign_id text,
  status               text not null default 'idle'
    check (status in ('idle', 'launching', 'live', 'failed', 'skipped')),
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists campaign_plan_google_launch (
  plan_id              uuid primary key references campaign_plans (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  draft_id             uuid references google_search_plans (id) on delete set null,
  platform_campaign_id text,
  status               text not null default 'idle'
    check (status in ('idle', 'launching', 'live', 'failed', 'skipped')),
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table campaign_plan_meta_launch is
  'Meta adapter outcome for a campaign_plan. No platform column — the table is the adapter.';
comment on table campaign_plan_tiktok_launch is
  'TikTok adapter outcome for a campaign_plan. No platform column — the table is the adapter.';
comment on table campaign_plan_google_launch is
  'Google adapter outcome for a campaign_plan. draft_id points at google_search_plans (live Google wizard), not legacy google_ad_plans.';

alter table campaign_plan_meta_launch enable row level security;
alter table campaign_plan_tiktok_launch enable row level security;
alter table campaign_plan_google_launch enable row level security;

drop policy if exists "Users can manage their own campaign_plan_meta_launch"
  on campaign_plan_meta_launch;
create policy "Users can manage their own campaign_plan_meta_launch"
  on campaign_plan_meta_launch
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own campaign_plan_tiktok_launch"
  on campaign_plan_tiktok_launch;
create policy "Users can manage their own campaign_plan_tiktok_launch"
  on campaign_plan_tiktok_launch
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own campaign_plan_google_launch"
  on campaign_plan_google_launch;
create policy "Users can manage their own campaign_plan_google_launch"
  on campaign_plan_google_launch
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists campaign_plan_meta_launch_updated_at on campaign_plan_meta_launch;
create trigger campaign_plan_meta_launch_updated_at
  before update on campaign_plan_meta_launch
  for each row execute procedure update_updated_at_column();

drop trigger if exists campaign_plan_tiktok_launch_updated_at on campaign_plan_tiktok_launch;
create trigger campaign_plan_tiktok_launch_updated_at
  before update on campaign_plan_tiktok_launch
  for each row execute procedure update_updated_at_column();

drop trigger if exists campaign_plan_google_launch_updated_at on campaign_plan_google_launch;
create trigger campaign_plan_google_launch_updated_at
  before update on campaign_plan_google_launch
  for each row execute procedure update_updated_at_column();

notify pgrst, 'reload schema';
