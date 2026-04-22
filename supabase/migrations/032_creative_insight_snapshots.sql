-- Migration 032 — creative_insight_snapshots
--
-- Cache table for the creative heatmap. The live Meta Graph fetch
-- behind /api/intelligence/creatives sequentially pages up to 20×
-- through /{act_id}/ads with insights expanded; for the 4TheFans
-- account (~1,258 ads) this takes ~5 minutes. Even with PR #17's
-- transient-error retries, that's a client-killer when we share
-- these views externally.
--
-- The fix is structural: keep the live fetch (users still want a
-- "Refresh now" button) but stop making it the default path.
-- /api/cron/refresh-creative-insights pre-warms this table every 2h
-- against the warm-set of (user, ad_account) pairs that have been
-- viewed at least once, and the read route serves the cache.
--
-- This is a CACHE, not a timeseries. UNIQUE on
-- (user_id, ad_account_id, ad_id, date_preset) — one row per ad per
-- window. If we want history later, add a separate table; do not
-- repurpose this one. `raw_insights jsonb` is reserved for future
-- breakdowns / attribution windows so we can avoid another migration.

create table if not exists creative_insight_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  ad_account_id       text not null check (ad_account_id like 'act_%'),
  ad_id               text not null,
  date_preset         text not null check (date_preset in (
    'today','yesterday','last_3d','last_7d','last_14d','last_30d','maximum'
  )),
  snapshot_at         timestamptz not null default now(),

  -- Dimensions pulled from Meta
  ad_name             text,
  ad_status           text,
  campaign_id         text,
  campaign_name       text,
  campaign_objective  text,
  adset_id            text,
  creative_id         text,
  creative_name       text,
  thumbnail_url       text,

  -- Metrics. All nullable because 0 is meaningful and missing isn't.
  spend               numeric(12,2),
  impressions         bigint,
  clicks              integer,
  ctr                 numeric(8,4),
  cpm                 numeric(10,4),
  cpc                 numeric(10,4),
  frequency           numeric(8,4),
  reach               bigint,
  link_clicks         integer,
  purchases           integer,
  -- Sum of action_type 'complete_registration' + 'lead' (+ allied
  -- registration-flavoured types). Computed at fetch time.
  registrations       integer,
  cpl                 numeric(10,2),
  fatigue_score       text check (fatigue_score in ('ok','warning','critical')),

  -- Escape hatch for future Meta breakdowns / attribution windows
  -- without re-migrating. Empty for the H1 release.
  raw_insights        jsonb,

  created_at          timestamptz not null default now(),

  unique (user_id, ad_account_id, ad_id, date_preset)
);

create index if not exists cis_user_account_preset_idx
  on creative_insight_snapshots (user_id, ad_account_id, date_preset, snapshot_at desc);

create index if not exists cis_objective_idx
  on creative_insight_snapshots (user_id, ad_account_id, campaign_objective);

alter table creative_insight_snapshots enable row level security;

drop policy if exists cis_owner_select on creative_insight_snapshots;
create policy cis_owner_select on creative_insight_snapshots
  for select using (user_id = auth.uid());

drop policy if exists cis_owner_insert on creative_insight_snapshots;
create policy cis_owner_insert on creative_insight_snapshots
  for insert with check (user_id = auth.uid());

drop policy if exists cis_owner_update on creative_insight_snapshots;
create policy cis_owner_update on creative_insight_snapshots
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists cis_owner_delete on creative_insight_snapshots;
create policy cis_owner_delete on creative_insight_snapshots
  for delete using (user_id = auth.uid());

comment on table creative_insight_snapshots is
  'Per-ad Meta insights cached from /intelligence/creatives to avoid 5-min live loads. Upserted by /api/cron/refresh-creative-insights (2h cadence) and by manual Refresh button. Unique key is (user_id, ad_account_id, ad_id, date_preset) so one row per ad per window — not append-only.';
