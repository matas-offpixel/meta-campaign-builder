-- Migration 211 — Creative Lab M6-A: releases, the claim ladder, reads and ticket warnings.
--
-- Write only. Not applied from this branch. Matas applies it after merge.
-- 210 is the applied migration this follows.

do $$ begin
  create type public.release_state as enum ('not_yet', 'on_sale', 'selling_fast', 'final_x', 'sold_out');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.release_state_source as enum ('vendor_page', 'client_message', 'entry');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.claim_trigger_kind as enum ('count_pct', 'state_days', 'state', 'page_remaining');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ticket_warning_state as enum ('held', 'locked', 'scheduled', 'live', 'done', 'back_to_held');
exception when duplicate_object then null;
end $$;

create table if not exists public.event_releases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  position integer not null,
  name text not null,
  community_at timestamptz,
  list_at timestamptz,
  state public.release_state not null default 'not_yet',
  state_at timestamptz,
  state_source public.release_state_source,
  state_set_by uuid,
  price numeric,
  capacity integer,
  sold integer,
  remaining integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, position)
);

comment on table public.event_releases is
  'One row per ticket release. events.presale_at and events.general_sale_at are derived from these rows on save, never typed a second time. Migration 211.';
comment on column public.event_releases.id is 'Primary key. Migration 211.';
comment on column public.event_releases.user_id is 'Owner. Matches events.user_id. RLS is auth.uid() = user_id. Migration 211.';
comment on column public.event_releases.event_id is 'The event these releases belong to. Cascade delete. Migration 211.';
comment on column public.event_releases.position is 'Order on the timeline, starting at 1. Unique per event. Migration 211.';
comment on column public.event_releases.name is 'The release name, as the operator typed it in Edit releases. Migration 211.';
comment on column public.event_releases.community_at is 'Community time. The first release''s community time is events.presale_at. Migration 211.';
comment on column public.event_releases.list_at is 'List time. The general-sale release''s list time is events.general_sale_at. Migration 211.';
comment on column public.event_releases.state is 'not_yet, on_sale, selling_fast, final_x or sold_out. Migration 211.';
comment on column public.event_releases.state_at is 'When the state was last set. Freshness counts from here. Migration 211.';
comment on column public.event_releases.state_source is 'vendor_page, client_message or entry. Picked once per event and remembered. Migration 211.';
comment on column public.event_releases.state_set_by is 'The operator who set the state. Null on the backfill. Migration 211.';
comment on column public.event_releases.price is 'Price, when known. Null until then. Migration 211.';
comment on column public.event_releases.capacity is 'Capacity, when known. A count writes tier_channel_sales only when this is set. Migration 211.';
comment on column public.event_releases.sold is 'Tickets sold, when a count was entered or synced. Null when there is no count. Migration 211.';
comment on column public.event_releases.remaining is 'Remaining, when the page or a count supplied it. Never typed as the X in final X. Migration 211.';
comment on column public.event_releases.created_at is 'When the row was inserted. Migration 211.';
comment on column public.event_releases.updated_at is 'When the row was last updated. Migration 211.';

create table if not exists public.client_claim_ladders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  position integer not null,
  trigger_kind public.claim_trigger_kind not null,
  trigger_value text not null,
  claim_template text not null,
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, position)
);

comment on table public.client_claim_ladders is
  'Per-client claim ladder. Seeded with Matas''s default. Edited on the Ticketing tab. Migration 211.';
comment on column public.client_claim_ladders.id is 'Primary key. Migration 211.';
comment on column public.client_claim_ladders.user_id is 'Owner. Matches clients.user_id. Migration 211.';
comment on column public.client_claim_ladders.client_id is 'The client whose ladder this is. Migration 211.';
comment on column public.client_claim_ladders.position is 'Order of the rung. Unique per client. Migration 211.';
comment on column public.client_claim_ladders.trigger_kind is 'count_pct, state_days, state or page_remaining. Migration 211.';
comment on column public.client_claim_ladders.trigger_value is 'The threshold: a percent, a state name, a day count, or roll_call. Migration 211.';
comment on column public.client_claim_ladders.claim_template is 'The words the asset may say. {release} is filled from the release name. Migration 211.';
comment on column public.client_claim_ladders.options is 'Days, percent versus final X, and whether the roll-call is preferred. Migration 211.';
comment on column public.client_claim_ladders.created_at is 'When the rung was inserted. Migration 211.';
comment on column public.client_claim_ladders.updated_at is 'When the rung was last edited. Migration 211.';

create table if not exists public.release_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  read_at timestamptz not null,
  source text not null,
  per_release jsonb not null,
  raw_ref text,
  created_at timestamptz not null default now()
);

comment on table public.release_reads is
  'One read or client-message entry. The vendor reader is not in this migration; entries write the rows. Migration 211.';
comment on column public.release_reads.id is 'Primary key. Migration 211.';
comment on column public.release_reads.user_id is 'Owner. Migration 211.';
comment on column public.release_reads.event_id is 'The event that was read. Migration 211.';
comment on column public.release_reads.read_at is 'When the read or the message was taken. Migration 211.';
comment on column public.release_reads.source is 'vendor_page, client_message or entry. Migration 211.';
comment on column public.release_reads.per_release is 'What the read saw, one object per release. Migration 211.';
comment on column public.release_reads.raw_ref is 'Optional pointer at a stored snapshot. Null for an entry. Migration 211.';
comment on column public.release_reads.created_at is 'When the row was inserted. Migration 211.';

create table if not exists public.ticket_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  release_id uuid references public.event_releases (id) on delete cascade,
  claim text not null,
  format text not null,
  state public.ticket_warning_state not null default 'held',
  trigger jsonb,
  approved_by uuid,
  approved_at timestamptz,
  runs_from timestamptz,
  runs_to timestamptz,
  render_id uuid,
  why text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, release_id, claim, format)
);

comment on table public.ticket_warnings is
  'One state row per event, release, claim and format. Nothing runs without Approve. Migration 211.';
comment on column public.ticket_warnings.id is 'Primary key. Migration 211.';
comment on column public.ticket_warnings.user_id is 'Owner. Migration 211.';
comment on column public.ticket_warnings.event_id is 'The event. Migration 211.';
comment on column public.ticket_warnings.release_id is 'The release the claim is about. Null only when a claim has no release. Migration 211.';
comment on column public.ticket_warnings.claim is 'The words that were proposed or approved. Migration 211.';
comment on column public.ticket_warnings.format is '9:16 video, 4:5, 1:1 or 9:16 static. Migration 211.';
comment on column public.ticket_warnings.state is 'held, locked, scheduled, live, done or back_to_held. Migration 211.';
comment on column public.ticket_warnings.trigger is 'The rung that allowed the claim: kind, value, source and time. Migration 211.';
comment on column public.ticket_warnings.approved_by is 'The operator who approved. Null until Approve. Migration 211.';
comment on column public.ticket_warnings.approved_at is 'When it was approved. Null until Approve. Migration 211.';
comment on column public.ticket_warnings.runs_from is 'When the claim may start. A live claim uses the release time. Migration 211.';
comment on column public.ticket_warnings.runs_to is 'When the claim stops. Not now moves this to the next window. Migration 211.';
comment on column public.ticket_warnings.render_id is 'A creative_lab_renders row, when a piece exists. Null in M6-A: nothing renders here. Migration 211.';
comment on column public.ticket_warnings.why is 'The one sentence on a back_to_held card. Null otherwise. Migration 211.';
comment on column public.ticket_warnings.created_at is 'When the row was inserted. Migration 211.';
comment on column public.ticket_warnings.updated_at is 'When the row was last updated. Migration 211.';

do $$
declare
  t text;
begin
  foreach t in array array['event_releases', 'client_claim_ladders', 'release_reads', 'ticket_warnings'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = format('Users can manage their own %s', t)
    ) then
      execute format(
        'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
        format('Users can manage their own %s', t),
        t
      );
    end if;
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
  end loop;

  foreach t in array array['event_releases', 'client_claim_ladders', 'ticket_warnings'] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute procedure update_updated_at_column()',
      t || '_updated_at',
      t
    );
  end loop;
end $$;

-- Backfill: two releases per event. Presale from presale_at, General sale from general_sale_at.
-- on_sale once that list time has passed, otherwise not_yet. Idempotent: skip events that already have a row.
insert into public.event_releases (user_id, event_id, position, name, community_at, list_at, state, state_at, state_source)
select e.user_id, e.id, 1, 'Presale', e.presale_at, e.presale_at,
  case when e.presale_at is not null and e.presale_at <= now() then 'on_sale'::public.release_state else 'not_yet'::public.release_state end,
  case when e.presale_at is not null and e.presale_at <= now() then e.presale_at else null end,
  'entry'
from public.events e
where not exists (select 1 from public.event_releases r where r.event_id = e.id);

insert into public.event_releases (user_id, event_id, position, name, community_at, list_at, state, state_at, state_source)
select e.user_id, e.id, 2, 'General sale', null, e.general_sale_at,
  case when e.general_sale_at is not null and e.general_sale_at <= now() then 'on_sale'::public.release_state else 'not_yet'::public.release_state end,
  case when e.general_sale_at is not null and e.general_sale_at <= now() then e.general_sale_at else null end,
  'entry'
from public.events e
where not exists (select 1 from public.event_releases r where r.event_id = e.id and r.position = 2);

-- Seed Matas's default ladder for every client that has none.
insert into public.client_claim_ladders (user_id, client_id, position, trigger_kind, trigger_value, claim_template, options)
select c.user_id, c.id, rung.position, rung.kind::public.claim_trigger_kind, rung.value, rung.template, rung.options::jsonb
from public.clients c
cross join (values
  (1, 'state', 'on_sale', '{release} live · selling fast', '{"days":0}'),
  (2, 'state_days', 'selling_fast', '{release} 90% sold out', '{"days":7,"wording":"percent","alt":"final X {release} tickets"}'),
  (3, 'count_pct', '50', '75% sold', '{}'),
  (4, 'count_pct', '60', '80% sold', '{}'),
  (5, 'count_pct', '70', '90% sold', '{}'),
  (6, 'count_pct', '80', '95% sold', '{}'),
  (7, 'count_pct', '90', '99% sold', '{"wording":"percent","alt":"final X"}'),
  (8, 'state', 'final_x', 'final X', '{}'),
  (9, 'state', 'sold_out', 'sold out', '{}'),
  (10, 'state', 'roll_call', '{sold} SOLD OUT
{live}', '{"preferred":true}')
) as rung(position, kind, value, template, options)
where not exists (select 1 from public.client_claim_ladders l where l.client_id = c.id);

notify pgrst, 'reload schema';
