-- Migration 265 — ad_library_pages + ad_library_ads (E9, the inspiration feed's store)
--
-- Graph ads_archive refuses this app (code 10 / 2332002) and covers EU
-- delivery only (PR #1354), so E9 reads the Ad Library through the Meta Ads
-- connector in a weekly Claude task, which writes here through
-- scripts/ad-library-ingest.mts (North Star issue 3, §9.5: interim tasks
-- write into the app's store).
--
-- ad_library_pages is the watchlist: a hand-kept seed (promoters, ticketing,
-- brands, competitors) plus artists a watched promoter advertises
-- (derived_from_page_id). ad_library_ads is one row per Ad Library ad seen.
--
-- No columns for body text, stop time, platforms or media type: the
-- connector doesn't return them. link_url and cta aren't in its response
-- either; they stay null until a source gives them. link_title is the
-- connector's ad_creative_link_title, its only creative text. raw keeps the
-- newest response object for the ad.
--
-- Long runner (the winner signal without spend) is read, not stored:
-- last_seen − start_date ≥ 30 days, from ACTIVE-only reads.
--
-- Operator-only cross-client knowledge (OP10): service role reads and
-- writes; authenticated reads nothing, the same as copy_features (213).
-- Share links and /admin/[clientSlug] never read these tables
-- (lib/learning/__tests__/cross-client-guard.test.ts).
--
-- Apply by hand: prod first, then CI, only when the PR is about to merge.
-- Idempotent. Not applied from the branch.

create table if not exists ad_library_pages (
  page_id               text primary key check (page_id ~ '^[0-9]+$'),
  name                  text not null,
  kind                  text not null check (kind in ('competitor', 'promoter', 'ticketing', 'brand', 'artist')),
  derived_from_page_id  text references ad_library_pages (page_id),
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ad_library_pages_not_self_derived check (derived_from_page_id is null or derived_from_page_id <> page_id)
);

comment on table ad_library_pages is
  'E9 watchlist: Facebook pages whose Ad Library ads are read weekly. Seed pages are hand-kept; artist pages carry the promoter they were derived from. Service role only. Migration 265.';
comment on column ad_library_pages.derived_from_page_id is
  'The watched promoter whose ads named this artist (Broadwick Live → Dj David Morales). Null for seed pages.';
comment on column ad_library_pages.active is
  'False takes the page off the weekly read without deleting its ads.';

create table if not exists ad_library_ads (
  ad_archive_id  text primary key check (ad_archive_id ~ '^[0-9]+$'),
  page_id        text not null references ad_library_pages (page_id),
  first_seen     date not null,
  last_seen      date not null,
  start_date     date,
  countries      text[] not null default '{}',
  link_url       text,
  cta            text,
  link_title     text,
  snapshot_url   text,
  raw            jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ad_library_ads_seen_order check (last_seen >= first_seen)
);

comment on table ad_library_ads is
  'E9: one row per Ad Library ad seen on a watched page, from the weekly connector read. Service role only. Migration 265.';
comment on column ad_library_ads.first_seen is
  'London date of the first read that returned the ad. Lags the real start by up to a week; long runners use start_date.';
comment on column ad_library_ads.last_seen is
  'London date of the latest ACTIVE read that returned the ad: the last day it was seen delivering. Never moves back.';
comment on column ad_library_ads.start_date is
  'Meta''s ad_delivery_start_time as a London date.';
comment on column ad_library_ads.countries is
  'The countries of the reads that returned the ad, unioned. Not Meta''s reach list.';
comment on column ad_library_ads.link_url is
  'Not in the connector''s response (23 Nov 2026). Null until a source gives it.';
comment on column ad_library_ads.cta is
  'Not in the connector''s response (23 Nov 2026). Null until a source gives it.';
comment on column ad_library_ads.link_title is
  'The connector''s ad_creative_link_title: the headline, e.g. "David Morales | Sat 20 Feb".';
comment on column ad_library_ads.raw is
  'The newest connector object for the ad, ids as strings.';

create index if not exists ad_library_ads_page_start_idx
  on ad_library_ads (page_id, start_date desc);
create index if not exists ad_library_ads_last_seen_idx
  on ad_library_ads (last_seen desc);
create index if not exists ad_library_pages_derived_idx
  on ad_library_pages (derived_from_page_id) where derived_from_page_id is not null;

alter table ad_library_pages enable row level security;
alter table ad_library_ads enable row level security;

do $$
begin
  -- A policy of false, not the absence of a policy: a later grant of
  -- authenticated SELECT still matches nothing. No insert, update or
  -- delete policy, so authenticated cannot write either.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ad_library_pages'
      and policyname = 'ad_library_pages no authenticated read'
  ) then
    execute
      'create policy "ad_library_pages no authenticated read" '
      'on ad_library_pages for select to authenticated using (false)';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ad_library_ads'
      and policyname = 'ad_library_ads no authenticated read'
  ) then
    execute
      'create policy "ad_library_ads no authenticated read" '
      'on ad_library_ads for select to authenticated using (false)';
  end if;
end $$;

notify pgrst, 'reload schema';
