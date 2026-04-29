-- Migration 059 — TikTok rollup extended metrics and breakdown snapshots
--
-- Apply manually post-merge via Cowork Supabase MCP. This migration extends
-- API-sourced TikTok reporting only; it does not introduce any TikTok write API
-- surface.

alter table event_daily_rollups
  add column if not exists tiktok_reach                 integer,
  add column if not exists tiktok_video_views_2s        integer,
  add column if not exists tiktok_video_views_6s        integer,
  add column if not exists tiktok_video_views_100p      integer,
  add column if not exists tiktok_avg_play_time_ms      integer,
  add column if not exists tiktok_post_engagement       integer;

comment on column event_daily_rollups.tiktok_video_views is
  'Backward-compatible TikTok video-view count. From migration 059 onward, tiktok_video_views_100p is the source of truth for 100% views.';

create table if not exists tiktok_breakdown_snapshots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  event_id          uuid not null references events on delete cascade,
  dimension         text not null check (dimension in (
    'country','region','city','age','gender','age_gender','interest_category'
  )),
  dimension_value   text not null,
  spend             numeric(12,2),
  impressions       integer,
  reach             integer,
  clicks            integer,
  ctr               numeric(8,4),
  video_views_2s    integer,
  video_views_6s    integer,
  video_views_100p  integer,
  avg_play_time_ms  integer,
  window_since      date not null,
  window_until      date not null,
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_id, dimension, dimension_value, window_since, window_until)
);

create index if not exists tiktok_breakdown_snapshots_event_dim_idx
  on tiktok_breakdown_snapshots (event_id, dimension, fetched_at desc);

create index if not exists tiktok_breakdown_snapshots_user_id_idx
  on tiktok_breakdown_snapshots (user_id);

alter table tiktok_breakdown_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tiktok_breakdown_snapshots'
      and policyname = 'service role only'
  ) then
    execute
      'create policy "service role only" on tiktok_breakdown_snapshots '
      'for all using (false) with check (false)';
  end if;
end $$;

create or replace function set_tiktok_breakdown_snapshots_updated_at()
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
    where tgrelid = 'public.tiktok_breakdown_snapshots'::regclass
      and tgname = 'tiktok_breakdown_snapshots_updated_at'
  ) then
    execute
      'create trigger tiktok_breakdown_snapshots_updated_at '
      'before update on tiktok_breakdown_snapshots '
      'for each row execute function set_tiktok_breakdown_snapshots_updated_at()';
  end if;
end $$;

notify pgrst, 'reload schema';
