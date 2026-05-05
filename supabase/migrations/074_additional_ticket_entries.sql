create table if not exists public.additional_ticket_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  event_id uuid not null references public.events(id) on delete cascade,
  scope text not null check (scope in ('event', 'tier')),
  tier_name text,
  tickets_count integer not null check (tickets_count >= 0),
  revenue_amount numeric default 0 check (revenue_amount >= 0),
  date date,
  source text check (
    source in (
      'partner_allocation',
      'complimentary',
      'offline_sale',
      'sponsor_pass',
      'group_booking',
      'reseller',
      'other'
    )
  ),
  label text not null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint additional_ticket_entries_scope_tier_consistency check (
    (scope = 'event' and tier_name is null) or
    (scope = 'tier' and tier_name is not null)
  )
);

create index if not exists additional_ticket_entries_event_id_idx
  on public.additional_ticket_entries(event_id);

alter table public.additional_ticket_entries enable row level security;

drop policy if exists additional_ticket_entries_select on public.additional_ticket_entries;
create policy additional_ticket_entries_select
  on public.additional_ticket_entries
  for select using (
    event_id in (select id from public.events where user_id = auth.uid())
    or auth.role() = 'service_role'
  );

drop policy if exists additional_ticket_entries_insert on public.additional_ticket_entries;
create policy additional_ticket_entries_insert
  on public.additional_ticket_entries
  for insert with check (
    event_id in (select id from public.events where user_id = auth.uid())
    or auth.role() = 'service_role'
  );

drop policy if exists additional_ticket_entries_update on public.additional_ticket_entries;
create policy additional_ticket_entries_update
  on public.additional_ticket_entries
  for update using (
    event_id in (select id from public.events where user_id = auth.uid())
    or auth.role() = 'service_role'
  );

drop policy if exists additional_ticket_entries_delete on public.additional_ticket_entries;
create policy additional_ticket_entries_delete
  on public.additional_ticket_entries
  for delete using (
    event_id in (select id from public.events where user_id = auth.uid())
    or auth.role() = 'service_role'
  );

create or replace function public.set_additional_ticket_entries_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_additional_ticket_entries_updated_at
  on public.additional_ticket_entries;
create trigger trg_additional_ticket_entries_updated_at
  before update on public.additional_ticket_entries
  for each row execute function public.set_additional_ticket_entries_updated_at();

notify pgrst, 'reload schema';
