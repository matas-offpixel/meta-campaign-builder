-- Migration 061 — Motion-replacement creative tag taxonomy and scores
--
-- Foundation for Motion replacement Phase 1b/1c. Apply manually via Cowork MCP.
--
-- `creative_tags` already exists from migration 020 as a legacy per-Meta-ad
-- tagging table. This migration evolves that table to also hold the closed
-- Motion-replacement taxonomy instead of destructively replacing it.

alter table creative_tags
  alter column meta_ad_id drop not null,
  alter column tag_type drop not null,
  alter column tag_value drop not null;

alter table creative_tags
  add column if not exists dimension text,
  add column if not exists value_key text,
  add column if not exists value_label text,
  add column if not exists description text,
  add column if not exists source text not null default 'motion_seed',
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.creative_tags'::regclass
      and conname = 'creative_tags_motion_dimension_check'
  ) then
    alter table creative_tags
      add constraint creative_tags_motion_dimension_check
      check (
        dimension is null
        or dimension in (
          'asset_type', 'visual_format', 'messaging_angle', 'intended_audience',
          'hook_tactic', 'headline_tactic', 'offer_type', 'seasonality'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.creative_tags'::regclass
      and conname = 'creative_tags_motion_source_check'
  ) then
    alter table creative_tags
      add constraint creative_tags_motion_source_check
      check (source in ('motion_seed', 'curated', 'custom'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.creative_tags'::regclass
      and conname = 'creative_tags_legacy_or_taxonomy_shape_check'
  ) then
    alter table creative_tags
      add constraint creative_tags_legacy_or_taxonomy_shape_check
      check (
        (
          meta_ad_id is not null
          and tag_type is not null
          and tag_value is not null
        )
        or (
          dimension is not null
          and value_key is not null
          and value_label is not null
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.creative_tags'::regclass
      and conname = 'creative_tags_user_dimension_value_key_unique'
  ) then
    alter table creative_tags
      add constraint creative_tags_user_dimension_value_key_unique
      unique (user_id, dimension, value_key);
  end if;
end $$;

create table if not exists creative_tag_assignments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  event_id        uuid not null references events on delete cascade,
  creative_name   text not null,
  tag_id          uuid not null references creative_tags on delete cascade,
  source          text not null check (source in ('manual', 'ai')),
  confidence      numeric(4,3),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, creative_name, tag_id)
);

create table if not exists creative_scores (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  event_id        uuid not null references events on delete cascade,
  creative_name   text not null,
  axis            text not null check (axis in ('hook', 'watch', 'click', 'convert')),
  score           integer not null check (score between 0 and 100),
  significance    boolean not null default false,
  fetched_at      timestamptz not null default now(),
  unique (event_id, creative_name, axis, fetched_at)
);

create index if not exists creative_tags_user_dimension_idx
  on creative_tags (user_id, dimension);
create index if not exists creative_tag_assignments_event_creative_idx
  on creative_tag_assignments (event_id, creative_name);
create index if not exists creative_scores_event_creative_idx
  on creative_scores (event_id, creative_name);

alter table creative_tags enable row level security;
alter table creative_tag_assignments enable row level security;
alter table creative_scores enable row level security;

drop policy if exists creative_tags_owner_update on creative_tags;
create policy creative_tags_owner_update
  on creative_tags for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'creative_tags'
      and policyname = 'Users can manage their own creative tags'
  ) then
    execute
      'create policy "Users can manage their own creative tags" '
      'on creative_tags for all '
      'using (auth.uid() = user_id) '
      'with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'creative_tag_assignments'
      and policyname = 'Users can manage their own creative tag assignments'
  ) then
    execute
      'create policy "Users can manage their own creative tag assignments" '
      'on creative_tag_assignments for all '
      'using (auth.uid() = user_id) '
      'with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'creative_scores'
      and policyname = 'Users can manage their own creative scores'
  ) then
    execute
      'create policy "Users can manage their own creative scores" '
      'on creative_scores for all '
      'using (auth.uid() = user_id) '
      'with check (auth.uid() = user_id)';
  end if;
end $$;

create or replace function set_creative_taxonomy_updated_at()
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
    where tgrelid = 'public.creative_tags'::regclass
      and tgname = 'creative_tags_updated_at'
  ) then
    execute
      'create trigger creative_tags_updated_at '
      'before update on creative_tags '
      'for each row execute function set_creative_taxonomy_updated_at()';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.creative_tag_assignments'::regclass
      and tgname = 'creative_tag_assignments_updated_at'
  ) then
    execute
      'create trigger creative_tag_assignments_updated_at '
      'before update on creative_tag_assignments '
      'for each row execute function set_creative_taxonomy_updated_at()';
  end if;
end $$;

notify pgrst, 'reload schema';
