-- Migration 076 — tier_channels
--
-- Per-client lookup of ticket-sale channels. Each event tier can be
-- allocated and sold across multiple channels (e.g. 4TF, Eventbrite,
-- Venue, SeeTickets, CP, Other). Channels marked is_automatic=true are
-- populated by the platform's existing API sync paths
-- (event_ticket_tiers powers 4TF + Eventbrite); channels with
-- is_automatic=false are entered manually by ops staff via the venue
-- report.
--
-- (client_id, channel_name) is the natural key — every client defines
-- their own channel set so a venue partner that only sells through
-- "DS" (Drill Shed) doesn't pollute another client's channel picker.

create table if not exists public.tier_channels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  channel_name text not null,
  display_label text not null,
  is_automatic boolean not null default false,
  provider_link text,
  created_at timestamptz not null default now(),
  unique (client_id, channel_name)
);

comment on table public.tier_channels is
  'Per-client lookup of ticket-sale channels (4TF, Eventbrite, Venue, SeeTickets, etc.). is_automatic=true channels are populated by API sync; is_automatic=false channels are entered manually via the venue report.';

create index if not exists tier_channels_client_id_idx
  on public.tier_channels (client_id);

alter table public.tier_channels enable row level security;

drop policy if exists tier_channels_select on public.tier_channels;
create policy tier_channels_select on public.tier_channels
  for select using (
    auth.role() = 'service_role'
    or client_id in (select id from public.clients where user_id = auth.uid())
  );

drop policy if exists tier_channels_insert on public.tier_channels;
create policy tier_channels_insert on public.tier_channels
  for insert with check (
    auth.role() = 'service_role'
    or client_id in (select id from public.clients where user_id = auth.uid())
  );

drop policy if exists tier_channels_update on public.tier_channels;
create policy tier_channels_update on public.tier_channels
  for update using (
    auth.role() = 'service_role'
    or client_id in (select id from public.clients where user_id = auth.uid())
  );

drop policy if exists tier_channels_delete on public.tier_channels;
create policy tier_channels_delete on public.tier_channels
  for delete using (
    auth.role() = 'service_role'
    or client_id in (select id from public.clients where user_id = auth.uid())
  );

-- Seed default channel set for the 4thefans client. Idempotent: re-runs
-- of the migration are no-ops thanks to ON CONFLICT.
do $$
declare
  fourthefans_client_id constant uuid := '37906506-56b7-4d58-ab62-1b042e2b561a';
begin
  if exists (select 1 from public.clients where id = fourthefans_client_id) then
    insert into public.tier_channels (client_id, channel_name, display_label, is_automatic)
    values
      (fourthefans_client_id, '4TF',         '4TF',         true),
      (fourthefans_client_id, 'Eventbrite',  'Eventbrite',  true),
      (fourthefans_client_id, 'Venue',       'Venue',       false),
      (fourthefans_client_id, 'SeeTickets',  'SeeTickets',  false),
      (fourthefans_client_id, 'CP',          'CP',          false),
      (fourthefans_client_id, 'DS',          'DS',          false),
      (fourthefans_client_id, 'Other',       'Other',       false)
    on conflict (client_id, channel_name) do nothing;
  end if;
end
$$;
