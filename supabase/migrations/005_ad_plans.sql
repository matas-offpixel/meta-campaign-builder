-- ─────────────────────────────────────────────────────────────────────────────
-- Marketing plan tables
-- A "plan" is the daily ad-budget pacing artefact for one event. Rows are
-- days between plan start and event date, columns are objective spend lines.
-- The plan also carries an audience set + a template snapshot mechanism for
-- reuse across similar events.
--
-- All four tables are RLS-scoped per user_id. user_id is denormalised onto
-- ad_plan_days / ad_plan_audiences so RLS doesn't have to traverse a join.
-- update_updated_at_column triggers keep updated_at fresh — function is
-- already defined in migration 003.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ad_plans (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  event_id        uuid        not null references events (id)     on delete cascade,
  name            text        not null,
  status          text        not null default 'draft',
  total_budget    numeric(12, 2),
  ticket_target   integer,
  landing_page_url text,
  start_date      date        not null,
  end_date        date        not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ad_plans_status_check check (
    status in ('draft', 'live', 'completed', 'archived')
  ),
  constraint ad_plans_dates_check check (end_date >= start_date)
);

create index if not exists ad_plans_user_event_idx
  on ad_plans (user_id, event_id);

alter table ad_plans enable row level security;

drop policy if exists "Users can manage their own ad_plans" on ad_plans;
create policy "Users can manage their own ad_plans"
  on ad_plans
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists ad_plans_updated_at on ad_plans;
create trigger ad_plans_updated_at
  before update on ad_plans
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Daily rows. One per (plan_id, day). Auto-seeded on plan create from
-- start_date..end_date. objective_budgets is a sparse jsonb keyed by
-- objective short-name; missing keys are treated as 0 by readers.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ad_plan_days (
  id                       uuid        primary key default gen_random_uuid(),
  plan_id                  uuid        not null references ad_plans (id) on delete cascade,
  user_id                  uuid        not null references auth.users (id) on delete cascade,
  day                      date        not null,
  phase_marker             text,
  allocation_pct           numeric(5, 2),
  objective_budgets        jsonb       not null default '{}'::jsonb,
  tickets_sold_cumulative  integer,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint ad_plan_days_unique unique (plan_id, day)
);

create index if not exists ad_plan_days_plan_day_idx
  on ad_plan_days (plan_id, day);

alter table ad_plan_days enable row level security;

drop policy if exists "Users can manage their own ad_plan_days" on ad_plan_days;
create policy "Users can manage their own ad_plan_days"
  on ad_plan_days
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists ad_plan_days_updated_at on ad_plan_days;
create trigger ad_plan_days_updated_at
  before update on ad_plan_days
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Audiences. Phase 3 — schema lands here so the FK exists; UI deferred.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ad_plan_audiences (
  id              uuid        primary key default gen_random_uuid(),
  plan_id         uuid        not null references ad_plans (id) on delete cascade,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  sort_order      integer     not null default 0,
  objective       text        not null,
  geo_bucket      text,
  city            text,
  location        text,
  proximity_km    numeric(5, 1),
  age_min         integer,
  age_max         integer,
  placements      text[]      not null default '{}',
  daily_budget    numeric(10, 2),
  total_budget    numeric(10, 2),
  audience_name   text,
  info            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ad_plan_audiences_objective_check check (
    objective in (
      'traffic', 'conversion', 'reach',
      'tiktok', 'google', 'snap', 'post_engagement'
    )
  )
);

create index if not exists ad_plan_audiences_plan_sort_idx
  on ad_plan_audiences (plan_id, sort_order);

alter table ad_plan_audiences enable row level security;

drop policy if exists "Users can manage their own ad_plan_audiences" on ad_plan_audiences;
create policy "Users can manage their own ad_plan_audiences"
  on ad_plan_audiences
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists ad_plan_audiences_updated_at on ad_plan_audiences;
create trigger ad_plan_audiences_updated_at
  before update on ad_plan_audiences
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Templates. Snapshot of (plan + days + audiences) shape, no FKs, so a
-- template survives the source plan being deleted. Unique name per user.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ad_plan_templates (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  name            text        not null,
  snapshot_json   jsonb       not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ad_plan_templates_name_unique_per_user unique (user_id, name)
);

create index if not exists ad_plan_templates_user_idx
  on ad_plan_templates (user_id);

alter table ad_plan_templates enable row level security;

drop policy if exists "Users can manage their own ad_plan_templates" on ad_plan_templates;
create policy "Users can manage their own ad_plan_templates"
  on ad_plan_templates
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists ad_plan_templates_updated_at on ad_plan_templates;
create trigger ad_plan_templates_updated_at
  before update on ad_plan_templates
  for each row execute procedure update_updated_at_column();


-- Refresh PostgREST schema cache so new tables are exposed to the API
notify pgrst, 'reload schema';
