-- Migration 184 — launched_ads (learning loop A: per-ad facts)
--
-- Ad ids live only in draft_json.launchSummary.creativesCreated[].ads[]
-- — a blob overwritten on relaunch, missing the multi-campaign loop, and
-- empty for bulk-attach. Nothing joins a Meta ad to the creative it
-- carried, the ad set it sits in, or the event and client it served.
--
-- One row per Meta ad this app creates. The creative descriptor is a
-- launch-time snapshot, not a reference. meta_adset_id joins
-- launched_ad_sets.meta_adset_id without a foreign key: attach modes put
-- ads into ad sets this app did not create, so there is no row to point at.
--
-- Apply by hand: prod first, then CI, only when the PR is about to
-- merge. Idempotent: if not exists + catalog-checked constraints.

create table if not exists launched_ads (
  id                      uuid primary key default gen_random_uuid(),
  meta_ad_id              text not null unique,
  meta_creative_id        text,
  meta_adset_id           text,
  meta_campaign_id        text,
  ad_account_id           text,
  draft_id                uuid references campaign_drafts(id) on delete set null,
  user_id                 uuid,
  client_id               uuid references clients(id) on delete set null,
  event_id                uuid references events(id) on delete set null,
  launched_at             timestamptz not null default now(),
  launch_run_id           uuid not null,
  channel                 text not null default 'meta',
  descriptor_source       text not null default 'launch',
  creative_name           text,
  ad_name                 text,
  media_type              text,
  source_type             text,
  placement_mode          text,
  variation_count         integer,
  cta                     text,
  destination_url         text,
  url_tags_applied        boolean,
  asset_content_hashes    jsonb not null default '[]'::jsonb,
  created_at              timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'launched_ads_channel_check'
  ) then
    alter table launched_ads
      add constraint launched_ads_channel_check
      check (channel in ('meta'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'launched_ads_descriptor_source_check'
  ) then
    alter table launched_ads
      add constraint launched_ads_descriptor_source_check
      check (descriptor_source in ('launch', 'backfill_from_launch_summary'));
  end if;
end $$;

create index if not exists launched_ads_draft_id_idx
  on launched_ads (draft_id);

create index if not exists launched_ads_event_id_idx
  on launched_ads (event_id);

create index if not exists launched_ads_client_launched_idx
  on launched_ads (client_id, launched_at desc);

create index if not exists launched_ads_meta_adset_id_idx
  on launched_ads (meta_adset_id);

comment on table launched_ads is
  'Learning loop A: one row per Meta ad this app creates. Creative descriptor is a launch-time snapshot. meta_ad_id joins ad_daily_insights; meta_adset_id joins launched_ad_sets (no FK — attach modes use ad sets we did not create). Migration 184.';
comment on column launched_ads.creative_name is
  'The draft creative''s name — the key creative_tag_assignments.creative_name joins on.';
comment on column launched_ads.ad_name is
  'The ad name sent to Meta (metaAdName(creative.name)).';
comment on column launched_ads.source_type is
  'uploaded (draft sourceType new) or existing_post.';
comment on column launched_ads.placement_mode is
  'Draft assetMode at launch: single | dual | full.';
comment on column launched_ads.url_tags_applied is
  'True when the creative carried our url_tags (lib/meta/url-tags.ts); false when the operator URL kept its own utm; null on backfilled rows (most predate url_tags).';
comment on column launched_ads.asset_content_hashes is
  'sha256 content hashes from creative_assets for the creative''s registered assets. [] when none are registered.';

alter table launched_ads enable row level security;

do $$
begin
  -- Own-rows only, same as launched_ad_sets (175): client_users are
  -- authenticated, and a cross-tenant SELECT would leak every client's
  -- Meta ids and creative descriptors.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'launched_ads'
      and policyname = 'authenticated read own launched_ads'
  ) then
    execute
      'create policy "authenticated read own launched_ads" '
      'on launched_ads for select '
      'to authenticated using (user_id = auth.uid())';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'launched_ads'
      and policyname = 'authenticated insert own launched_ads'
  ) then
    execute
      'create policy "authenticated insert own launched_ads" '
      'on launched_ads for insert '
      'to authenticated with check (user_id = auth.uid())';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'launched_ads'
      and policyname = 'authenticated update own launched_ads'
  ) then
    execute
      'create policy "authenticated update own launched_ads" '
      'on launched_ads for update '
      'to authenticated using (user_id = auth.uid())';
  end if;
end $$;

notify pgrst, 'reload schema';
