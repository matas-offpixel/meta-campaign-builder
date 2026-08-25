-- ============================================================================
-- 155_lp_page_views.sql
-- ============================================================================
--
-- First-party landing-page-view capture (roadmap v2 Phase B).
-- page_events is LP *config*, not views. event_signups is PII signups.
-- This table counts views, not people: no cookies, no fingerprint, no PII.
--
-- Writes go through POST /api/l/{slug}/{slug}/view (service-role). RLS is
-- SELECT-only for event owners and client members so the #837 funnel
-- helper can COUNT at read time — same pattern as event_signups.
--
-- Apply via Supabase MCP apply_migration. Verification block must print
-- `migration 155 verification: all assertions passed`.
-- ============================================================================

create table if not exists lp_page_views (
  id           uuid        primary key default gen_random_uuid(),
  event_id     uuid        not null references events (id) on delete cascade,
  occurred_at  timestamptz not null default now(),
  utm          jsonb       not null default '{}'::jsonb,
  geo_country  text,
  geo_region   text,
  geo_city     text,
  referrer     text,
  created_at   timestamptz not null default now()
);

comment on table lp_page_views is
  'First-party landing-page views from /l. Counts views, not people. No PII. utm jsonb mirrors event_signups (utm_* + fbclid/ttclid/gclid). Geo is server-derived from Vercel headers. Metric label: page views (unfiltered). Migration 155.';

comment on column lp_page_views.utm is
  'Allowlisted attribution keys only — same shape as event_signups.utm so Phase B click-ID joins cannot drift.';

comment on column lp_page_views.geo_country is
  'ISO-3166-1 alpha-2 from x-vercel-ip-country. Server-derived, never from the body.';

create index if not exists lp_page_views_event_occurred_idx
  on lp_page_views (event_id, occurred_at);

alter table lp_page_views enable row level security;

drop policy if exists lpv_owner_select on lp_page_views;
create policy lpv_owner_select on lp_page_views
  for select
  using (
    exists (
      select 1 from events e
      where e.id = lp_page_views.event_id
        and e.user_id = auth.uid()
    )
  );

drop policy if exists lpv_client_member_select on lp_page_views;
create policy lpv_client_member_select on lp_page_views
  for select
  using (
    exists (
      select 1 from events e
      join client_users cu on cu.client_id = e.client_id
      where e.id = lp_page_views.event_id
        and cu.user_id = auth.uid()
    )
  );

do $$
declare
  has_table boolean;
  has_event_idx boolean;
  has_rls boolean;
  policy_count int;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'lp_page_views'
  ) into has_table;

  select exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'lp_page_views'
      and indexname = 'lp_page_views_event_occurred_idx'
  ) into has_event_idx;

  select c.relrowsecurity
    into has_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'lp_page_views';

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'lp_page_views';

  if not has_table then
    raise exception 'migration 155 verification: lp_page_views missing';
  end if;
  if not has_event_idx then
    raise exception 'migration 155 verification: event/occurred index missing';
  end if;
  if has_rls is not true then
    raise exception 'migration 155 verification: RLS not enabled';
  end if;
  if policy_count < 2 then
    raise exception 'migration 155 verification: expected ≥2 SELECT policies, got %', policy_count;
  end if;

  raise notice 'migration 155 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
