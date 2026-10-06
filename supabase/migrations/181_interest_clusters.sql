-- Migration 181 — saved interest clusters + clients.vertical
--
-- interest_clusters: an operator's reusable interest sets for the
-- Audiences step. A pick copies the interests into a new draft group;
-- nothing here is read at launch. Seeds (migration 182) come from
-- docs/analysis/interest-templates-seed.json, built from the 2026-10-06
-- interest-performance report.
--
-- clients.vertical: the strip shows only clusters of the draft client's
-- vertical. Backfill: 4theFans → football, every other client → music.
--
-- Apply manually after review.

alter table clients
  add column if not exists vertical text not null default 'music';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_vertical_check') then
    alter table clients
      add constraint clients_vertical_check check (vertical in ('music', 'football', 'other'));
  end if;
end $$;

update clients set vertical = 'football' where slug = '4thefans';

comment on column clients.vertical is
  'music | football | other. Filters the saved interest clusters strip in the Audiences step. Migration 181.';

create table if not exists interest_clusters (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  vertical      text not null check (vertical in ('music', 'football', 'other')),
  interests     jsonb not null default '[]'::jsonb,
  evidence      jsonb,
  source        text not null check (source in ('seed', 'operator')),
  use_count     integer not null default 0,
  last_used_at  timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint interest_clusters_user_name_key unique (user_id, name)
);

comment on table interest_clusters is
  'Saved interest sets. interests = [{id,name}] Meta interest ids. evidence = report figures (adSets, spend GBP, registrations, cpr, cprSource, cprIndex, clients, confidence) or null. Archive, never delete. Migration 181.';

create index if not exists interest_clusters_user_idx
  on interest_clusters (user_id, archived_at, use_count desc);

alter table interest_clusters enable row level security;

drop policy if exists "Users can manage their own interest_clusters" on interest_clusters;
create policy "Users can manage their own interest_clusters"
  on interest_clusters
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists interest_clusters_updated_at on interest_clusters;
create trigger interest_clusters_updated_at
  before update on interest_clusters
  for each row execute procedure update_updated_at_column();

notify pgrst, 'reload schema';
