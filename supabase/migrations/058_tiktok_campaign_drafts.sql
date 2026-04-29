-- Migration 058 — TikTok campaign creator draft tables
--
-- Foundation only. Stores TikTok wizard drafts/templates; no TikTok write API
-- surface is introduced by this migration.

create table if not exists tiktok_campaign_drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  client_id   uuid references clients on delete set null,
  event_id    uuid references events on delete set null,
  name        text,
  status      text not null default 'draft'
    check (status in ('draft','published','archived')),
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tiktok_campaign_drafts_user_updated_idx
  on tiktok_campaign_drafts (user_id, updated_at desc);

create index if not exists tiktok_campaign_drafts_client_idx
  on tiktok_campaign_drafts (client_id);

create index if not exists tiktok_campaign_drafts_event_idx
  on tiktok_campaign_drafts (event_id);

alter table tiktok_campaign_drafts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tiktok_campaign_drafts'
      and policyname = 'Users can manage their own TikTok drafts'
  ) then
    execute
      'create policy "Users can manage their own TikTok drafts" '
      'on tiktok_campaign_drafts for all '
      'using (auth.uid() = user_id) '
      'with check (auth.uid() = user_id)';
  end if;
end $$;

create table if not exists tiktok_campaign_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  description text,
  tags        text[] not null default '{}',
  snapshot    jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tiktok_campaign_templates_user_updated_idx
  on tiktok_campaign_templates (user_id, updated_at desc);

alter table tiktok_campaign_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tiktok_campaign_templates'
      and policyname = 'Users can manage their own TikTok templates'
  ) then
    execute
      'create policy "Users can manage their own TikTok templates" '
      'on tiktok_campaign_templates for all '
      'using (auth.uid() = user_id) '
      'with check (auth.uid() = user_id)';
  end if;
end $$;

create or replace function set_tiktok_campaign_drafts_updated_at()
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
    select 1 from pg_trigger
    where tgrelid = 'public.tiktok_campaign_drafts'::regclass
      and tgname = 'tiktok_campaign_drafts_updated_at'
  ) then
    execute
      'create trigger tiktok_campaign_drafts_updated_at '
      'before update on tiktok_campaign_drafts '
      'for each row execute function set_tiktok_campaign_drafts_updated_at()';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.tiktok_campaign_templates'::regclass
      and tgname = 'tiktok_campaign_templates_updated_at'
  ) then
    execute
      'create trigger tiktok_campaign_templates_updated_at '
      'before update on tiktok_campaign_templates '
      'for each row execute function set_tiktok_campaign_drafts_updated_at()';
  end if;
end $$;

notify pgrst, 'reload schema';
