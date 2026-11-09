-- Asset bank issue 3. Roll-call kind, four derived rungs, event_offers.
-- New enum values are appended, so this file can write them in the same transaction.
-- Applied by Matas from main after merge. This file removes nothing.

alter type public.claim_trigger_kind add value if not exists 'roll_call';
alter type public.claim_trigger_kind add value if not exists 'velocity';
alter type public.claim_trigger_kind add value if not exists 'price_rise_date';
alter type public.claim_trigger_kind add value if not exists 'countdown_pct';
alter type public.claim_trigger_kind add value if not exists 'lineup_add';

-- 211 seeded position 10 as kind state, value roll_call, options {"preferred":true}.
-- A14 keeps preferred and changes the kind. The words still come from event_releases.
update public.client_claim_ladders
set trigger_kind = 'roll_call',
    claim_template = '{sold} RELEASE SOLD OUT' || E'\n' || '{live}'
where position = 10
  and trigger_value = 'roll_call'
  and trigger_kind = 'state';

insert into public.client_claim_ladders (user_id, client_id, position, trigger_kind, trigger_value, claim_template, options)
select c.user_id, c.id, rung.position, rung.kind::public.claim_trigger_kind, rung.value, rung.template, rung.options::jsonb
from public.clients c
cross join (values
  (11, 'velocity', '500', '{n}+ TICKETS SOLD IN THE LAST 2 WEEKS', '{"windowDays":14,"threshold":500}'),
  (12, 'price_rise_date', '4', 'PRICES RISE {DAY}', '{"days":4,"alt":"LAST CHANCE AT £{n}"}'),
  (13, 'countdown_pct', '14', E'LESS THAN 2 WEEKS TO GO\nOVER 90% SOLD OUT', '{"days":14}'),
  (14, 'lineup_add', 'lineup', '{ARTIST} (JUST ANNOUNCED)', '{}')
) as rung(position, kind, value, template, options)
where exists (select 1 from public.client_claim_ladders l where l.client_id = c.id)
  and not exists (
    select 1 from public.client_claim_ladders l
    where l.client_id = c.id and l.position = rung.position
  );

create table if not exists public.event_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in ('payment_plan', 'group', 'early_entry')),
  figures jsonb not null default '{}'::jsonb,
  condition text,
  from_at timestamptz,
  until_at timestamptz,
  entered_by uuid references auth.users (id),
  entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.event_offers is
  'An offer Matas entered. No trigger makes it true, and it is not a ladder rung. Migration 221.';
comment on column public.event_offers.id is 'Primary key. Migration 221.';
comment on column public.event_offers.user_id is 'Owner. Migration 221.';
comment on column public.event_offers.event_id is 'The event the offer belongs to. Migration 221.';
comment on column public.event_offers.kind is 'payment_plan, group or early_entry. Migration 221.';
comment on column public.event_offers.figures is 'The numbers Matas typed: today, parts, price, arrive. Migration 221.';
comment on column public.event_offers.condition is 'The condition he typed, if any. Migration 221.';
comment on column public.event_offers.from_at is 'When the offer may start. Null until he sets one. Migration 221.';
comment on column public.event_offers.until_at is 'When the offer ends. Null until he sets one. Migration 221.';
comment on column public.event_offers.entered_by is 'Who entered it. Migration 221.';
comment on column public.event_offers.entered_at is 'When it was entered. Migration 221.';
comment on column public.event_offers.created_at is 'When the row was inserted. Migration 221.';
comment on column public.event_offers.updated_at is 'When the row was last updated. Migration 221.';

alter table public.event_offers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'event_offers' and policyname = 'Users can manage their own event_offers'
  ) then
    create policy "Users can manage their own event_offers"
      on public.event_offers
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'event_offers_updated_at') then
    create trigger event_offers_updated_at
      before update on public.event_offers
      for each row execute procedure update_updated_at_column();
  end if;
end $$;

notify pgrst, 'reload schema';
