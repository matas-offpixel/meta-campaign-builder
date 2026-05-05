-- Migration 069 — Meta custom audience creator foundation
--
-- PR-A only: persists draft audience definitions and idempotency keys.
-- Live Meta write calls are intentionally deferred to PR-B.

create table if not exists meta_custom_audiences (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  client_id          uuid not null references clients(id) on delete cascade,
  event_id           uuid null references events(id) on delete set null,
  name               text not null,
  funnel_stage       text not null check (funnel_stage in (
    'top_of_funnel',
    'mid_funnel',
    'bottom_funnel',
    'retargeting'
  )),
  audience_subtype   text not null check (audience_subtype in (
    'page_engagement_fb',
    'page_engagement_ig',
    'page_followers_fb',
    'page_followers_ig',
    'video_views',
    'website_pixel'
  )),
  retention_days     int not null check (retention_days > 0 and retention_days <= 365),
  source_id          text not null,
  source_meta        jsonb not null default '{}'::jsonb,
  meta_audience_id   text null,
  meta_ad_account_id text not null,
  status             text not null default 'draft' check (status in (
    'draft',
    'creating',
    'ready',
    'failed',
    'archived'
  )),
  status_error       text null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists meta_custom_audiences_user_client_status_idx
  on meta_custom_audiences (user_id, client_id, status);

create index if not exists meta_custom_audiences_event_idx
  on meta_custom_audiences (event_id)
  where event_id is not null;

create index if not exists meta_custom_audiences_meta_audience_idx
  on meta_custom_audiences (meta_audience_id)
  where meta_audience_id is not null;

alter table meta_custom_audiences enable row level security;

drop policy if exists meta_custom_audiences_owner on meta_custom_audiences;
create policy meta_custom_audiences_owner
  on meta_custom_audiences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists meta_audience_write_idempotency (
  idempotency_key text primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  audience_id      uuid not null references meta_custom_audiences(id) on delete cascade,
  meta_audience_id text null,
  created_at       timestamptz not null default now()
);

alter table meta_audience_write_idempotency enable row level security;

drop policy if exists meta_audience_write_idempotency_owner
  on meta_audience_write_idempotency;
create policy meta_audience_write_idempotency_owner
  on meta_audience_write_idempotency
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.set_updated_at()
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
    where tgrelid = 'public.meta_custom_audiences'::regclass
      and tgname = 'meta_custom_audiences_updated_at'
  ) then
    execute
      'create trigger meta_custom_audiences_updated_at '
      'before update on meta_custom_audiences '
      'for each row execute function public.set_updated_at()';
  end if;
end $$;

notify pgrst, 'reload schema';
