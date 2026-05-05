alter table event_ticketing_links
add column if not exists manual_lock boolean not null default false;

create index if not exists event_ticketing_links_manual_lock_idx
  on event_ticketing_links(manual_lock);

create table if not exists external_event_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  connection_id uuid not null references client_ticketing_connections(id) on delete cascade,
  provider text not null,
  external_event_id text not null,
  event_name text not null,
  venue text,
  start_date timestamptz,
  url text,
  capacity integer,
  tickets_sold integer,
  status text,
  raw_payload jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_event_id)
);

create index if not exists external_event_candidates_connection_idx
  on external_event_candidates(connection_id);

create index if not exists external_event_candidates_client_provider_idx
  on external_event_candidates(client_id, provider);

create index if not exists external_event_candidates_start_date_idx
  on external_event_candidates(start_date);

alter table external_event_candidates enable row level security;

drop policy if exists external_event_candidates_owner_select on external_event_candidates;
create policy external_event_candidates_owner_select on external_event_candidates
  for select using (auth.uid() = user_id);

drop policy if exists external_event_candidates_owner_insert on external_event_candidates;
create policy external_event_candidates_owner_insert on external_event_candidates
  for insert with check (auth.uid() = user_id);

drop policy if exists external_event_candidates_owner_update on external_event_candidates;
create policy external_event_candidates_owner_update on external_event_candidates
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists external_event_candidates_owner_delete on external_event_candidates;
create policy external_event_candidates_owner_delete on external_event_candidates
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
