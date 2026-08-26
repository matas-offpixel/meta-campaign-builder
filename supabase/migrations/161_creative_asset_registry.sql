-- Migration 161 — creative asset registry + routing (M.2 / CR.1)
--
-- Deterministic identity at upload: sha256(content) + byte size.
-- Channel ids record that an asset has been uploaded to a given Meta ad
-- account or TikTok advertiser AT MOST once. Plan routing is a child of
-- campaign_plans so the matrix can persist toggles and per-cell failures
-- without growing targeting or upload UI on /plan.
--
-- Historical backfill is a named follow-up — this file does not seed
-- existing Meta/TikTok library assets.
--
-- Foundation only. Apply manually after review. Do not apply in this run.

create table if not exists creative_assets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  content_hash       text not null,
  byte_size          bigint not null check (byte_size >= 0),
  filename           text not null,
  media_kind         text not null check (media_kind in ('image', 'video')),
  aspect_ratio       text not null
    check (aspect_ratio in ('1:1', '4:5', '9:16', 'other')),
  duration_seconds   numeric,
  storage_bucket     text not null default 'campaign-assets',
  storage_path       text not null,
  thumbnail_url      text,
  created_at         timestamptz not null default now(),
  unique (user_id, content_hash, byte_size)
);

comment on table creative_assets is
  'CR.1 registry. Identity is sha256(bytes) + byte_size per user. Wizards register at upload; no historical backfill in 161.';
comment on column creative_assets.content_hash is
  'Hex sha256 of the file bytes. Paired with byte_size as the dedupe key.';
comment on column creative_assets.storage_path is
  'Object in the existing campaign-assets bucket (videos/ / images/). Reuses the #594/#597 TUS path; not a new upload stack.';

create index if not exists creative_assets_user_created_idx
  on creative_assets (user_id, created_at desc);

create table if not exists creative_asset_channel_ids (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references creative_assets (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  channel      text not null check (channel in ('meta', 'tiktok')),
  scope        text not null,
  platform_id  text not null,
  created_at   timestamptz not null default now(),
  unique (asset_id, channel, scope)
);

comment on table creative_asset_channel_ids is
  'At-most-once platform upload per asset × channel × scope. Meta scope = ad account; TikTok scope = advertiser. A hit is a no-op.';
comment on column creative_asset_channel_ids.scope is
  'Meta ad account id (act_…) or TikTok advertiser id.';
comment on column creative_asset_channel_ids.platform_id is
  'Meta image_hash / video_id, or TikTok video_id.';

create index if not exists creative_asset_channel_ids_lookup_idx
  on creative_asset_channel_ids (user_id, channel, scope, platform_id);

create table if not exists campaign_plan_asset_routes (
  plan_id              uuid not null references campaign_plans (id) on delete cascade,
  asset_id             uuid not null references creative_assets (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  channel              text not null check (channel in ('tiktok')),
  enabled              boolean not null default false,
  upload_status        text not null default 'idle'
    check (upload_status in ('idle', 'ready', 'failed', 'launched')),
  upload_error         text,
  derived_creative_id  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (plan_id, asset_id, channel)
);

comment on table campaign_plan_asset_routes is
  'Plan routing matrix state. TikTok is the only toggleable channel. Meta is informational; Google takes no assets.';

create index if not exists campaign_plan_asset_routes_plan_idx
  on campaign_plan_asset_routes (plan_id);

alter table creative_assets enable row level security;
alter table creative_asset_channel_ids enable row level security;
alter table campaign_plan_asset_routes enable row level security;

drop policy if exists "Users can manage their own creative_assets" on creative_assets;
create policy "Users can manage their own creative_assets"
  on creative_assets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own creative_asset_channel_ids"
  on creative_asset_channel_ids;
create policy "Users can manage their own creative_asset_channel_ids"
  on creative_asset_channel_ids
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage their own campaign_plan_asset_routes"
  on campaign_plan_asset_routes;
create policy "Users can manage their own campaign_plan_asset_routes"
  on campaign_plan_asset_routes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists campaign_plan_asset_routes_updated_at on campaign_plan_asset_routes;
create trigger campaign_plan_asset_routes_updated_at
  before update on campaign_plan_asset_routes
  for each row execute procedure update_updated_at_column();

notify pgrst, 'reload schema';
