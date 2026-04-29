-- Migration 057 — tiktok_active_creatives_snapshots
--
-- TikTok analogue of migration 041's active_creatives_snapshots table.
-- Populated by a service-role cron so public share-report renders read
-- cached TikTok ad rows rather than fanning out to the TikTok API.
--
-- Apply manually post-merge via Cowork Supabase MCP.

create table if not exists tiktok_active_creatives_snapshots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  event_id          uuid not null references events on delete cascade,
  ad_id             text not null,
  ad_name           text,
  campaign_id       text,
  campaign_name     text,
  status            text check (status in ('ACTIVE','NOT_DELIVERING','PAUSED','UNKNOWN')),
  spend             numeric(12,2),
  impressions       integer,
  reach             integer,
  clicks            integer,
  ctr               numeric(8,4),
  video_views_2s    integer,
  video_views_6s    integer,
  video_views_100p  integer,
  thumbnail_url     text,
  deeplink_url      text,
  ad_text           text,
  window_since      date not null,
  window_until      date not null,
  kind              text not null check (kind in ('ok','skip','error')),
  error_message     text,
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_id, ad_id, window_since, window_until)
);

create index if not exists tiktok_acs_event_fetched_idx
  on tiktok_active_creatives_snapshots (event_id, fetched_at desc);

create index if not exists tiktok_acs_user_id_idx
  on tiktok_active_creatives_snapshots (user_id);

alter table tiktok_active_creatives_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tiktok_active_creatives_snapshots'
      and policyname = 'service role only'
  ) then
    execute
      'create policy "service role only" on tiktok_active_creatives_snapshots '
      'for all using (false) with check (false)';
  end if;
end $$;

create or replace function set_tiktok_acs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.tiktok_active_creatives_snapshots'::regclass
      and tgname = 'tiktok_acs_updated_at'
  ) then
    execute
      'create trigger tiktok_acs_updated_at '
      'before update on tiktok_active_creatives_snapshots '
      'for each row execute function set_tiktok_acs_updated_at()';
  end if;
end $$;

notify pgrst, 'reload schema';
