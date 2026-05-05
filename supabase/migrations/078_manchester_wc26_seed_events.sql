-- Backfill three existing WC26 Depot Mayfield (Manchester) shell events
-- (Croatia, Panama, Last 32): UPDATE venue/capacity/dates from the Ghana template,
-- then seed tiers + channel rows from `MASTER Allocations.xlsx` tab "Depot (Manchester)".
--
-- Shell rows must already exist with slugs:
--   wc26-manchester-croatia, wc26-manchester-panama, wc26-manchester-last32
--
-- Idempotent: always applies UPDATE from Ghana. INSERT tiers/allocs/sales only when
-- Croatia still has zero `event_ticket_tiers` rows (clears orphan tier_channel_allocations
-- on Croatia/Panama and tier_channel_sales on all three before seed).

begin;

do $$
declare
  cid constant uuid := '37906506-56b7-4d58-ab62-1b042e2b561a';
  tmpl record;
  e_croatia uuid;
  e_panama uuid;
  e_last32 uuid;
begin
  select e.* into tmpl
  from public.events e
  where e.client_id = cid
    and e.event_code = 'WC26-MANCHESTER'
    and e.name ilike '%Ghana%'
  limit 1;

  if tmpl.id is null then
    raise exception 'Migration 078: template Manchester Ghana event not found for client %', cid;
  end if;

  select id into e_croatia
  from public.events
  where client_id = cid
    and slug = 'wc26-manchester-croatia'
  limit 1;

  select id into e_panama
  from public.events
  where client_id = cid
    and slug = 'wc26-manchester-panama'
  limit 1;

  select id into e_last32
  from public.events
  where client_id = cid
    and slug = 'wc26-manchester-last32'
  limit 1;

  if e_croatia is null or e_panama is null or e_last32 is null then
    raise exception
      'Migration 078: missing shell event(s). Expected slugs wc26-manchester-croatia, wc26-manchester-panama, wc26-manchester-last32 for client %',
      cid;
  end if;

  update public.events e
  set
    capacity = g.capacity,
    venue_id = g.venue_id,
    genres = g.genres,
    venue_country = g.venue_country,
    venue_name = g.venue_name,
    venue_city = g.venue_city,
    event_timezone = g.event_timezone,
    preferred_provider = null,
    event_date = case e.id
      when e_croatia then date '2026-06-17'
      when e_panama then date '2026-06-27'
      when e_last32 then date '2026-07-01'
    end,
    event_start_at = case e.id
      when e_croatia then timestamptz '2026-06-17 21:00:00+01'
      when e_panama then timestamptz '2026-06-27 22:00:00+01'
      when e_last32 then null::timestamptz
    end
  from public.events g
  where g.id = tmpl.id
    and e.id in (e_croatia, e_panama, e_last32);

  if (select count(*)::int from public.event_ticket_tiers where event_id = e_croatia) = 0 then
    delete from public.tier_channel_allocations
    where event_id in (e_croatia, e_panama);

    delete from public.tier_channel_sales
    where event_id in (e_croatia, e_panama, e_last32);
    -- Croatia: event_ticket_tiers
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'GA - 4 for 3 (Earlybird)', 4.5, 124, 0, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'GA (Earlybird)', 6, 41, 0, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'GA - 4 for 3 (2nd Release)', 6, 16, 184, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'GA (2nd Release)', 8, 6, 194, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'GA - 4 for 3 (Final Release)', 7.5, 0, 600, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'GA (Final Release)', 10, 0, 800, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'GA (Extra Allocation)', 12.5, 0, 250, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'GA (Resell)', 15, 0, 250, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'Family Seated (3rd Release)', 10, 17, 28, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'Family Seated (Final Release)', 15, 0, 45, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'Sports Bar Premium Seated (Earlybird)', 25, 16, 332, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'Sports Bar Premium Seated (Final Release)', 30, 0, 100, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_croatia, 'Platform VIP Front Row - Own Table of 8 (Final Release)', 40, 16, 68, now());
    -- Panama: event_ticket_tiers
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'GA - 4 for 3 (Earlybird)', 4.5, 132, 0, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'GA (Earlybird)', 6, 67, 0, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'GA - 4 for 3 (2nd Release)', 6, 52, 148, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'GA (2nd Release)', 8, 13, 187, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'GA - 4 for 3 (Final Release)', 7.5, 0, 1300, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'GA (Final Release)', 10, 0, 1800, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'GA (Extra Allocation)', 12.5, 0, 250, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'GA (Resell)', 15, 0, 250, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'Family Seated (3rd Release)', 10, 14, 31, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'Family Seated (Final Release)', 15, 0, 45, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'Sports Bar Premium Seated (Earlybird)', 25, 34, 302, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'Sports Bar Premium Seated (Final Release)', 30, 0, 100, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_panama, 'Platform VIP Front Row - Own Table of 8 (Final Release)', 40, 24, 52, now());
    -- Last 32: event_ticket_tiers
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'GA - 4 for 3 (Earlybird)', 4.5, 32, 144, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'GA (Earlybird)', 6, 7, 43, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'GA - 4 for 3 (2nd Release)', 6, 0, 200, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'GA (2nd Release)', 8, 0, 200, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'GA - 4 for 3 (Final Release)', 7.5, 0, 600, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'GA (Final Release)', 10, 0, 800, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'GA (Extra Allocation)', 12.5, 0, 250, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'GA (Resell)', 15, 0, 250, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'Family Seated (3rd Release)', 10, 0, 45, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'Family Seated (Final Release)', 15, 0, 45, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'Sports Bar Premium Seated (Earlybird)', 25, 0, 350, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'Sports Bar Premium Seated (Final Release)', 30, 0, 100, now());
    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)
      VALUES (e_last32, 'Platform VIP Front Row - Own Table of 8 (Final Release)', 40, 0, 84, now());
    -- tier_channel_allocations (e_croatia)
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA - 4 for 3 (Earlybird)', tc.id, 52, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA - 4 for 3 (Earlybird)', tc.id, 124, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Earlybird)', tc.id, 9, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Earlybird)', tc.id, 41, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA - 4 for 3 (2nd Release)', tc.id, 40, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA - 4 for 3 (2nd Release)', tc.id, 60, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA - 4 for 3 (2nd Release)', tc.id, 100, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (2nd Release)', tc.id, 40, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (2nd Release)', tc.id, 60, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (2nd Release)', tc.id, 100, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA - 4 for 3 (Final Release)', tc.id, 120, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA - 4 for 3 (Final Release)', tc.id, 180, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA - 4 for 3 (Final Release)', tc.id, 300, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Final Release)', tc.id, 160, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Final Release)', tc.id, 240, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Final Release)', tc.id, 400, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Extra Allocation)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Extra Allocation)', tc.id, 75, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Extra Allocation)', tc.id, 125, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Resell)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Resell)', tc.id, 75, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'GA (Resell)', tc.id, 125, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Family Seated (3rd Release)', tc.id, 13, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Family Seated (3rd Release)', tc.id, 32, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Family Seated (Final Release)', tc.id, 13, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Family Seated (Final Release)', tc.id, 32, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Sports Bar Premium Seated (Earlybird)', tc.id, 70, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Sports Bar Premium Seated (Earlybird)', tc.id, 105, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Sports Bar Premium Seated (Earlybird)', tc.id, 175, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Sports Bar Premium Seated (Final Release)', tc.id, 20, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Sports Bar Premium Seated (Final Release)', tc.id, 30, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Sports Bar Premium Seated (Final Release)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 16, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 24, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_croatia, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 44, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    -- tier_channel_allocations (e_panama)
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA - 4 for 3 (Earlybird)', tc.id, 108, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA - 4 for 3 (Earlybird)', tc.id, 132, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Earlybird)', tc.id, 59, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Earlybird)', tc.id, 67, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA - 4 for 3 (2nd Release)', tc.id, 40, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA - 4 for 3 (2nd Release)', tc.id, 60, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA - 4 for 3 (2nd Release)', tc.id, 100, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (2nd Release)', tc.id, 40, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (2nd Release)', tc.id, 60, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (2nd Release)', tc.id, 100, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA - 4 for 3 (Final Release)', tc.id, 260, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA - 4 for 3 (Final Release)', tc.id, 388, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA - 4 for 3 (Final Release)', tc.id, 652, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Final Release)', tc.id, 360, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Final Release)', tc.id, 540, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Final Release)', tc.id, 900, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Extra Allocation)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Extra Allocation)', tc.id, 75, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Extra Allocation)', tc.id, 125, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Resell)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Resell)', tc.id, 75, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'GA (Resell)', tc.id, 125, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Family Seated (3rd Release)', tc.id, 13, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Family Seated (3rd Release)', tc.id, 32, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Family Seated (Final Release)', tc.id, 13, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Family Seated (Final Release)', tc.id, 32, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Sports Bar Premium Seated (Earlybird)', tc.id, 70, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Sports Bar Premium Seated (Earlybird)', tc.id, 105, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Sports Bar Premium Seated (Earlybird)', tc.id, 175, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Sports Bar Premium Seated (Final Release)', tc.id, 20, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Sports Bar Premium Seated (Final Release)', tc.id, 30, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Sports Bar Premium Seated (Final Release)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 16, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 24, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_panama, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 44, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    -- tier_channel_allocations (e_last32)
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA - 4 for 3 (Earlybird)', tc.id, 52, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA - 4 for 3 (Earlybird)', tc.id, 124, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Earlybird)', tc.id, 9, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Earlybird)', tc.id, 41, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA - 4 for 3 (2nd Release)', tc.id, 40, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA - 4 for 3 (2nd Release)', tc.id, 60, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA - 4 for 3 (2nd Release)', tc.id, 100, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (2nd Release)', tc.id, 40, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (2nd Release)', tc.id, 60, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (2nd Release)', tc.id, 100, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA - 4 for 3 (Final Release)', tc.id, 120, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA - 4 for 3 (Final Release)', tc.id, 180, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA - 4 for 3 (Final Release)', tc.id, 300, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Final Release)', tc.id, 160, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Final Release)', tc.id, 240, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Final Release)', tc.id, 400, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Extra Allocation)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Extra Allocation)', tc.id, 75, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Extra Allocation)', tc.id, 125, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Resell)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Resell)', tc.id, 75, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'GA (Resell)', tc.id, 125, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Family Seated (3rd Release)', tc.id, 13, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Family Seated (3rd Release)', tc.id, 32, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Family Seated (Final Release)', tc.id, 13, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Family Seated (Final Release)', tc.id, 32, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Sports Bar Premium Seated (Earlybird)', tc.id, 70, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Sports Bar Premium Seated (Earlybird)', tc.id, 105, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Sports Bar Premium Seated (Earlybird)', tc.id, 175, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Sports Bar Premium Seated (Final Release)', tc.id, 20, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Sports Bar Premium Seated (Final Release)', tc.id, 30, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Sports Bar Premium Seated (Final Release)', tc.id, 50, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 16, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'SeeTickets';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 24, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)
      SELECT e_last32, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 44, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '4TF';
    -- tier_channel_sales Venue (e_croatia)
    INSERT INTO public.tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, snapshot_at)
      SELECT e_croatia, 'GA - 4 for 3 (Earlybird)', tc.id, 52, (52::numeric * 4.5::numeric), false, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, snapshot_at)
      SELECT e_croatia, 'GA (Earlybird)', tc.id, 9, (9::numeric * 6::numeric), false, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, snapshot_at)
      SELECT e_croatia, 'Sports Bar Premium Seated (Earlybird)', tc.id, 2, (2::numeric * 25::numeric), false, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    -- tier_channel_sales Venue (e_panama)
    INSERT INTO public.tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, snapshot_at)
      SELECT e_panama, 'GA - 4 for 3 (Earlybird)', tc.id, 108, (108::numeric * 4.5::numeric), false, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, snapshot_at)
      SELECT e_panama, 'GA (Earlybird)', tc.id, 59, (59::numeric * 6::numeric), false, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, snapshot_at)
      SELECT e_panama, 'Sports Bar Premium Seated (Earlybird)', tc.id, 14, (14::numeric * 25::numeric), false, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';
    INSERT INTO public.tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, snapshot_at)
      SELECT e_panama, 'Platform VIP Front Row - Own Table of 8 (Final Release)', tc.id, 8, (8::numeric * 40::numeric), false, now()
      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';

  end if;

end;
$$;

commit;

notify pgrst, 'reload schema';
