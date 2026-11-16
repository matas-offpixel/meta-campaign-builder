-- 247_cirqlin_page_audience.sql
--
-- Dashboard v2 phase 2, HE2: CIRQLIN page audience, one row per linked page
-- per fetch day (UTC), holding that page's all-time figures from
-- GET /api/partner/page-audience (cirqlin #631, #633). Written by the 23:55 UTC
-- mailchimp-eod-snapshot cron after its signups pass, behind
-- ENABLE_CIRQLIN_AUDIENCE_INGEST. A second fetch on the same day restates
-- that day's row.
--
-- Counts only. No person-level data: no email, phone, name, IP or
-- coordinate. A city is named only when CIRQLIN counts 10 or more signups
-- there; the rest are in geo_everywhere_else, and blank locations in
-- geo_couldnt_tell. The three always sum to signups (the client rejects a
-- body where they don't).
--
-- event_id is the event whose events.cirqlin_page_id is the page at fetch
-- time. The umbrella page (nx-loves-aw26, NX26-GLOBAL) is its own row with
-- is_umbrella true, copied from events.is_umbrella, and is never summed
-- into shows.
--
-- signups_check is the smoke test: this row's signups against the stored
-- GET /api/partner/signups total for the same page (all time,
-- signup_source_snapshots, source 'cirqlin', via page_id). 'ok' when equal,
-- 'mismatch' when not (both numbers kept), 'unchecked' when there is no
-- stored page-id total written in the same cron run (PB5: an older total
-- is never compared). Never corrected.
--
-- partner_box_offered (cirqlin #633) is whether the page's live form shows
-- at least one partner consent tick box on the fetch day; null for a row
-- fetched before CIRQLIN returned the key. partner_opt_in is 0 both where
-- there is no box and where nobody ticked it; this column tells them apart.
--
-- Service-role writes; owner-only read, as 245.

create table if not exists public.cirqlin_page_audience (
  page_id uuid not null,
  fetch_day date not null,
  event_id uuid references public.events (id) on delete set null,
  is_umbrella boolean not null default false,
  signups integer not null check (signups >= 0),
  geo_cities jsonb not null default '[]'::jsonb,
  geo_everywhere_else integer not null check (geo_everywhere_else >= 0),
  geo_couldnt_tell integer not null check (geo_couldnt_tell >= 0),
  consent_marketing integer not null check (consent_marketing >= 0),
  channels_offered text[] not null default '{}',
  community_joined integer not null check (community_joined >= 0),
  community_link_clicks integer not null check (community_link_clicks >= 0),
  community_code_shared boolean not null,
  whatsapp_with_phone integer not null check (whatsapp_with_phone >= 0),
  partner_opt_in integer not null check (partner_opt_in >= 0),
  partner_box_offered boolean,
  daily_timezone text not null,
  signups_check text not null check (signups_check in ('ok', 'mismatch', 'unchecked')),
  signups_stored integer check (signups_stored is null or signups_stored >= 0),
  signups_stored_at timestamptz,
  fetched_at timestamptz not null default now(),
  primary key (page_id, fetch_day),
  constraint cirqlin_page_audience_geo_cities_array check (jsonb_typeof(geo_cities) = 'array'),
  constraint cirqlin_page_audience_check_numbers check (
    (signups_check = 'unchecked' and signups_stored is null)
    or (signups_check = 'ok' and signups_stored = signups)
    or (signups_check = 'mismatch' and signups_stored is not null and signups_stored <> signups)
  )
);

comment on table public.cirqlin_page_audience is
  'HE2: CIRQLIN page audience (all-time counts) per linked page per fetch day. Counts only. The umbrella page is its own row (is_umbrella), never summed into shows.';
comment on column public.cirqlin_page_audience.geo_cities is
  'Array of { name, region, country, signups }, cities with 10 or more signups, as CIRQLIN returns them.';
comment on column public.cirqlin_page_audience.signups_check is
  'ok | mismatch | unchecked: signups against the /api/partner/signups page-id total stored in the same cron run (signups_stored). Logged, never corrected.';
comment on column public.cirqlin_page_audience.partner_box_offered is
  'The live form shows at least one partner consent tick box (cirqlin #633). Null: fetched before CIRQLIN returned it.';

create index if not exists cirqlin_page_audience_event_day
  on public.cirqlin_page_audience (event_id, fetch_day desc);

alter table public.cirqlin_page_audience enable row level security;

drop policy if exists cirqlin_page_audience_select_own on public.cirqlin_page_audience;
create policy cirqlin_page_audience_select_own on public.cirqlin_page_audience
  for select using (
    auth.role() = 'service_role'
    or event_id in (select id from public.events where user_id = auth.uid())
  );

-- No insert, update or delete policy: service role only.
