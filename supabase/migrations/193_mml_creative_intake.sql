-- Migration 193 — MML creative intake (M2)
--
-- Which files belong to a plan, a dragged aspect override, and the Match
-- groups that Send turns into Meta creatives. 9:16 videos still route
-- through campaign_plan_asset_routes (migration 161); this file does not
-- touch that table.
--
-- Owner-only RLS, same shape as 161. Apply manually after review.
-- Idempotent: if not exists + catalog-checked policies.

create table if not exists campaign_plan_intake_assets (
  plan_id            uuid not null references campaign_plans (id) on delete cascade,
  asset_id           uuid not null references creative_assets (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  detected_bucket    text not null
    check (detected_bucket in ('1:1', '4:5', '9:16', 'other')),
  aspect_override    text
    check (aspect_override is null or aspect_override in ('1:1', '4:5', '9:16', 'other')),
  detected_width     integer,
  detected_height    integer,
  unreadable_reason  text,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (plan_id, asset_id)
);

comment on table campaign_plan_intake_assets is
  'MML ②. Files dropped on a plan. detected_bucket is from pixel dimensions; aspect_override is a drag. Re-dropping the same sha256 does not insert a second creative_assets row.';
comment on column campaign_plan_intake_assets.aspect_override is
  'Set when the operator drags the tile into another column. Null means the detected bucket stands.';
comment on column campaign_plan_intake_assets.unreadable_reason is
  'Why the file is in Other when dimensions could not be read, or the measured size is not 4:5, 1:1 or 9:16.';

create index if not exists campaign_plan_intake_assets_plan_idx
  on campaign_plan_intake_assets (plan_id, sort_order);

create table if not exists campaign_plan_creative_groups (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references campaign_plans (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  stable_key         text not null,
  position           integer not null default 0,
  meta_creative_id   text,
  sent_fingerprint   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (plan_id, stable_key)
);

comment on table campaign_plan_creative_groups is
  'MML ② Match groups, plus one row per single (stable_key single:<asset id>) once Send has written it. meta_creative_id is the only creative Send may update or remove.';
comment on column campaign_plan_creative_groups.stable_key is
  'Match group id, or single:<creative_assets id>. Unique per plan so a second Send updates the same creative.';
comment on column campaign_plan_creative_groups.sent_fingerprint is
  'What Send last wrote. If the draft creative no longer matches, the operator edited it in the drawer and Send leaves it.';
comment on column campaign_plan_creative_groups.meta_creative_id is
  'AdCreativeDraft id inside the linked Meta draft. Not a Meta platform id.';

create index if not exists campaign_plan_creative_groups_plan_idx
  on campaign_plan_creative_groups (plan_id);

create table if not exists campaign_plan_creative_group_members (
  group_id   uuid not null references campaign_plan_creative_groups (id) on delete cascade,
  plan_id    uuid not null references campaign_plans (id) on delete cascade,
  asset_id   uuid not null references creative_assets (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  position   integer not null default 0,
  primary key (group_id, asset_id),
  unique (plan_id, asset_id)
);

comment on table campaign_plan_creative_group_members is
  'Assets in one Match group. An asset is in at most one group per plan; unmatched assets are singles.';

create index if not exists campaign_plan_creative_group_members_group_idx
  on campaign_plan_creative_group_members (group_id, position);

alter table campaign_plan_intake_assets enable row level security;
alter table campaign_plan_creative_groups enable row level security;
alter table campaign_plan_creative_group_members enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'campaign_plan_intake_assets'
      and policyname = 'Users can manage their own campaign_plan_intake_assets'
  ) then
    create policy "Users can manage their own campaign_plan_intake_assets"
      on campaign_plan_intake_assets
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'campaign_plan_creative_groups'
      and policyname = 'Users can manage their own campaign_plan_creative_groups'
  ) then
    create policy "Users can manage their own campaign_plan_creative_groups"
      on campaign_plan_creative_groups
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'campaign_plan_creative_group_members'
      and policyname = 'Users can manage their own campaign_plan_creative_group_members'
  ) then
    create policy "Users can manage their own campaign_plan_creative_group_members"
      on campaign_plan_creative_group_members
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

drop trigger if exists campaign_plan_intake_assets_updated_at on campaign_plan_intake_assets;
create trigger campaign_plan_intake_assets_updated_at
  before update on campaign_plan_intake_assets
  for each row execute procedure update_updated_at_column();

drop trigger if exists campaign_plan_creative_groups_updated_at on campaign_plan_creative_groups;
create trigger campaign_plan_creative_groups_updated_at
  before update on campaign_plan_creative_groups
  for each row execute procedure update_updated_at_column();

notify pgrst, 'reload schema';
