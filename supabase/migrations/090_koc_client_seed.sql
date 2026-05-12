-- Migration 090 — Seed Kick Off Club client row + 16 WC26 event rows.
--
-- Client: Kick Off Club, London-based WC26 fanzone operator (3 venues).
-- Ref: docs/PROJECT_INSTRUCTIONS_KICKOFFCLUB_2026-05-12.md
--
-- Event code convention: WC26-KOC-[VENUE]-[FIXTURE] (fixture-level).
-- The venue-spend-allocator temp branch (venue-spend-allocator.ts)
-- strips the fixture suffix for Meta campaign bracket matching, e.g.:
--   WC26-KOC-BRIXTON-ENG-CRO → [WC26-KOC-BRIXTON]
--
-- Idempotent: ON CONFLICT (user_id, slug) DO NOTHING on all inserts.
--
-- Note: clients.website column not yet in schema; URL stored in notes.
-- Hackney 7th fixture (TBC): seed reactively when client confirms.

begin;

-- ── Client ───────────────────────────────────────────────────────────

insert into public.clients (
  user_id,
  name,
  slug,
  primary_type,
  meta_business_id,
  meta_ad_account_id,
  meta_pixel_id,
  notes
)
values (
  'b3ee4e5c-44e6-4684-acf6-efefbecd5858',
  'Kick Off Club',
  'kick-off-club',
  'promoter',
  '1511422815580007',
  '846585971788824',
  '2586414775104720',
  'website: https://kickoffclub.co.uk'
)
on conflict (user_id, slug) do nothing;

-- ── Events ───────────────────────────────────────────────────────────

do $$
declare
  uid  constant uuid := 'b3ee4e5c-44e6-4684-acf6-efefbecd5858';
  cid  uuid;
begin
  select id into cid from public.clients where user_id = uid and slug = 'kick-off-club';
  if cid is null then
    raise exception 'Migration 090: kick-off-club client row not found for user %', uid;
  end if;

  -- Brixton (Electric Brixton, cap 1500)

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-brixton-eng-cro', 'England vs Croatia', 'WC26-KOC-BRIXTON-ENG-CRO', 1500, 'Electric Brixton', 'London', 'GB', 'Europe/London', '2026-06-17', timestamptz '2026-06-17 19:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-brixton-aus-usa', 'Australia vs USA', 'WC26-KOC-BRIXTON-AUS-USA', 1500, 'Electric Brixton', 'London', 'GB', 'Europe/London', '2026-06-19', timestamptz '2026-06-19 18:30:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-brixton-eng-gha', 'England vs Ghana', 'WC26-KOC-BRIXTON-ENG-GHA', 1500, 'Electric Brixton', 'London', 'GB', 'Europe/London', '2026-06-23', timestamptz '2026-06-23 19:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-brixton-sco-bra', 'Scotland vs Brazil', 'WC26-KOC-BRIXTON-SCO-BRA', 1500, 'Electric Brixton', 'London', 'GB', 'Europe/London', '2026-06-24', timestamptz '2026-06-24 21:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-brixton-eng-pan', 'England vs Panama', 'WC26-KOC-BRIXTON-ENG-PAN', 1500, 'Electric Brixton', 'London', 'GB', 'Europe/London', '2026-06-27', timestamptz '2026-06-27 20:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  -- Hackney (Colour Factory, cap 800)

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-hackney-fra-sen', 'France vs Senegal', 'WC26-KOC-HACKNEY-FRA-SEN', 800, 'Colour Factory', 'London', 'GB', 'Europe/London', '2026-06-16', timestamptz '2026-06-16 18:30:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-hackney-eng-cro', 'England vs Croatia', 'WC26-KOC-HACKNEY-ENG-CRO', 800, 'Colour Factory', 'London', 'GB', 'Europe/London', '2026-06-17', timestamptz '2026-06-17 19:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-hackney-aus-usa', 'Australia vs USA', 'WC26-KOC-HACKNEY-AUS-USA', 800, 'Colour Factory', 'London', 'GB', 'Europe/London', '2026-06-19', timestamptz '2026-06-19 18:30:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-hackney-sco-mor', 'Scotland vs Morocco', 'WC26-KOC-HACKNEY-SCO-MOR', 800, 'Colour Factory', 'London', 'GB', 'Europe/London', '2026-06-19', timestamptz '2026-06-19 22:30:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-hackney-eng-gha', 'England vs Ghana', 'WC26-KOC-HACKNEY-ENG-GHA', 800, 'Colour Factory', 'London', 'GB', 'Europe/London', '2026-06-23', timestamptz '2026-06-23 19:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-hackney-sco-bra', 'Scotland vs Brazil', 'WC26-KOC-HACKNEY-SCO-BRA', 800, 'Colour Factory', 'London', 'GB', 'Europe/London', '2026-06-24', timestamptz '2026-06-24 21:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  -- Soho (Outernet, cap 2000)
  -- Note: 2000 per client brief (project doc said 1300; corrected here).

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-soho-fra-sen', 'France vs Senegal', 'WC26-KOC-SOHO-FRA-SEN', 2000, 'Outernet', 'London', 'GB', 'Europe/London', '2026-06-16', timestamptz '2026-06-16 18:30:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-soho-eng-cro', 'England vs Croatia', 'WC26-KOC-SOHO-ENG-CRO', 2000, 'Outernet', 'London', 'GB', 'Europe/London', '2026-06-17', timestamptz '2026-06-17 19:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-soho-eng-gha', 'England vs Ghana', 'WC26-KOC-SOHO-ENG-GHA', 2000, 'Outernet', 'London', 'GB', 'Europe/London', '2026-06-23', timestamptz '2026-06-23 19:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-soho-sco-bra', 'Scotland vs Brazil', 'WC26-KOC-SOHO-SCO-BRA', 2000, 'Outernet', 'London', 'GB', 'Europe/London', '2026-06-24', timestamptz '2026-06-24 21:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

  insert into public.events (user_id, client_id, slug, name, event_code, capacity, venue_name, venue_city, venue_country, event_timezone, event_date, event_start_at, status)
  values (uid, cid, 'wc26-koc-soho-eng-pan', 'England vs Panama', 'WC26-KOC-SOHO-ENG-PAN', 2000, 'Outernet', 'London', 'GB', 'Europe/London', '2026-06-27', timestamptz '2026-06-27 20:00:00+01', 'upcoming')
  on conflict (user_id, slug) do nothing;

end;
$$;

commit;

notify pgrst, 'reload schema';
