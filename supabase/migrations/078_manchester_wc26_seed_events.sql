-- Seed three WC26 Depot Mayfield (Manchester) events missing from prod:
-- England v Croatia, England v Panama, Last 32 — cloned from the existing
-- Manchester Ghana row for venue/capacity/genres, with calendar dates from the
-- ops sheet and tier ladder + channel rows derived from `MASTER Allocations.xlsx`
-- tab "Depot (Manchester)" (same source as `master-allocations-parser`).
--
-- Idempotent: skips when slugs already exist for the 4theFans client.

begin;

do $$
declare
  cid constant uuid := '37906506-56b7-4d58-ab62-1b042e2b561a';
  tmpl record;
  e_croatia uuid := gen_random_uuid();
  e_panama uuid := gen_random_uuid();
  e_last32 uuid := gen_random_uuid();
  slug_croatia text;
  slug_panama text;
  slug_last32 text;
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

  slug_croatia := regexp_replace(tmpl.slug, 'ghana', 'croatia', 'i');
  slug_panama := regexp_replace(tmpl.slug, 'ghana', 'panama', 'i');
  slug_last32 := regexp_replace(tmpl.slug, 'ghana', 'last-32', 'i');

  if exists (select 1 from public.events where user_id = tmpl.user_id and slug = slug_croatia) then
    raise notice 'Migration 078: Croatia slug already present — skipping seed.';
    return;
  end if;

  insert into public.events (
    id, user_id, client_id, name, slug, event_code, capacity, genres,
    venue_name, venue_city, venue_country, event_timezone,
    event_date, event_start_at,
    ticket_url, signup_url, status, budget_marketing, notes, favourite, report_cadence,
    venue_id, preferred_provider
  ) values (
    e_croatia,
    tmpl.user_id,
    cid,
    regexp_replace(tmpl.name, 'Ghana', 'Croatia', 'i'),
    slug_croatia,
    'WC26-MANCHESTER',
    tmpl.capacity,
    tmpl.genres,
    tmpl.venue_name,
    tmpl.venue_city,
    tmpl.venue_country,
    tmpl.event_timezone,
    date '2026-06-17',
    timestamptz '2026-06-17 21:00:00+01',
    null,
    tmpl.signup_url,
    tmpl.status,
    tmpl.budget_marketing,
    tmpl.notes,
    false,
    tmpl.report_cadence,
    tmpl.venue_id,
    null
  );

  insert into public.events (
    id, user_id, client_id, name, slug, event_code, capacity, genres,
    venue_name, venue_city, venue_country, event_timezone,
    event_date, event_start_at,
    ticket_url, signup_url, status, budget_marketing, notes, favourite, report_cadence,
    venue_id, preferred_provider
  ) values (
    e_panama,
    tmpl.user_id,
    cid,
    regexp_replace(tmpl.name, 'Ghana', 'Panama', 'i'),
    slug_panama,
    'WC26-MANCHESTER',
    tmpl.capacity,
    tmpl.genres,
    tmpl.venue_name,
    tmpl.venue_city,
    tmpl.venue_country,
    tmpl.event_timezone,
    date '2026-06-27',
    timestamptz '2026-06-27 22:00:00+01',
    null,
    tmpl.signup_url,
    tmpl.status,
    tmpl.budget_marketing,
    tmpl.notes,
    false,
    tmpl.report_cadence,
    tmpl.venue_id,
    null
  );

  insert into public.events (
    id, user_id, client_id, name, slug, event_code, capacity, genres,
    venue_name, venue_city, venue_country, event_timezone,
    event_date, event_start_at,
    ticket_url, signup_url, status, budget_marketing, notes, favourite, report_cadence,
    venue_id, preferred_provider
  ) values (
    e_last32,
    tmpl.user_id,
    cid,
    regexp_replace(tmpl.name, 'England[[:space:]]+v[[:space:]]+Ghana', 'Last 32', 'i'),
    slug_last32,
    'WC26-MANCHESTER',
    tmpl.capacity,
    tmpl.genres,
    tmpl.venue_name,
    tmpl.venue_city,
    tmpl.venue_country,
    tmpl.event_timezone,
    date '2026-07-01',
    null,
    null,
    tmpl.signup_url,
    tmpl.status,
    tmpl.budget_marketing,
    tmpl.notes,
    false,
    tmpl.report_cadence,
    tmpl.venue_id,
    null
  );
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

end;
$$;

commit;

notify pgrst, 'reload schema';
