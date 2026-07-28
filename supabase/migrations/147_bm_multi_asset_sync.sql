-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 147 — BM Asset Sync v2 (Ad Accounts, Pixels, Instagram Accounts)
--
-- Migration 145 shipped V1: Pages only. Matas is Admin on ~50 client Business
-- Managers, but Meta does not grant BM Admins per-ASSET user access implicitly
-- for any asset type — pages were only the first symptom. This migration adds
-- the three remaining asset types the wizard actually needs:
--
--   1. bm_ad_accounts  — ad accounts owned by / shared into the BM
--   2. bm_pixels       — Meta pixels (datasets)
--   3. bm_ig_accounts  — Instagram BUSINESS ASSETS (see the id note below)
--
-- plus it generalises bm_page_access_events from page-only to any asset type.
--
-- ── Field provenance ────────────────────────────────────────────────────────
-- Every column below mirrors a field verified live against the Graph API
-- (v23.0) on 2026-07-28 rather than copied from Meta's docs. The full capture
-- is in docs/session-logs/pr-726-ops-bm-asset-sync-v2.md. Highlights:
--
--   * Ad accounts (GET /{bizId}/owned_ad_accounts | client_ad_accounts) return
--     id ("act_<n>"), account_id ("<n>"), name, account_status, currency,
--     timezone_name, disable_reason, amount_spent, business_name. BOTH id forms
--     are stored: `ad_account_id` keeps Meta's "act_"-prefixed node id (what
--     grant calls address) and `account_id` the bare numeric form (what the
--     rest of this codebase uses).
--
--   * Pixels (GET /{bizId}/owned_pixels | client_pixels) return id, name,
--     creation_time, is_unavailable, enable_automatic_matching,
--     data_use_setting. `last_fired_time` is a VALID field but is frequently
--     absent from the payload, hence nullable.
--
--   * Instagram (GET /{bizId}/owned_instagram_assets | client_instagram_assets)
--     return TWO distinct ids: `id` is the BUSINESS ASSET id and `ig_user_id`
--     is the IG user id. These are NOT interchangeable — grants must address
--     the business asset id. Both are stored so the wizard can join on
--     ig_user_id while grants use ig_asset_id.
--     NOTE: `client_instagram_accounts` (the edge name the original brief
--     assumed) DOES NOT EXIST — it 400s with code 100 "Tried accessing
--     nonexisting field". The real pair is owned_/client_instagram_assets.
--     profile_pic / followed_by_count / media_count are accepted as fields but
--     return empty for most assets, so all three are nullable.
--
-- ── user_tasks ──────────────────────────────────────────────────────────────
-- Each table stores the operator's ACTUAL granted tasks, not just a boolean.
-- Verified live: Meta expands a grant — requesting tasks=["ADVERTISE"] on an
-- IG asset returned ["ADVERTISE","ANALYZE","CONTENT","MESSAGES",
-- "COMMUNITY_ACTIVITY"] on read-back. So "did the grant work?" must be a
-- SUPERSET check against the requested tasks, never an equality check, and the
-- UI needs the real task list to explain what access exists.
--
-- RLS + write model: identical to migration 145 — authenticated read (the app
-- is invite-only; all authenticated users are operators), no INSERT/UPDATE/
-- DELETE policies, every write goes through the service-role client in routes /
-- cron behind a cookie session + operator allowlist.
--
-- Reversibility:
--   drop table if exists bm_ad_accounts;
--   drop table if exists bm_pixels;
--   drop table if exists bm_ig_accounts;
--   alter table bm_page_access_events drop column if exists asset_type;
--   alter table bm_page_access_events drop column if exists asset_id;
--   alter table bm_page_access_events alter column page_id set not null;
--
-- Idempotent: `if not exists` + catalog-checked DO blocks throughout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── bm_ad_accounts ──────────────────────────────────────────────────────────

create table if not exists bm_ad_accounts (
  id              uuid        primary key default gen_random_uuid(),
  business_id     text        not null references client_business_managers (business_id) on delete cascade,
  -- Meta's node id, "act_"-prefixed. This is what POST /{id}/assigned_users addresses.
  ad_account_id   text        not null,
  -- Bare numeric form, for joins against the rest of the codebase.
  account_id      text,
  name            text,
  account_status  integer,
  currency        text,
  timezone_name   text,
  disable_reason  integer,
  is_owned_by_bm  boolean     not null default true,
  user_has_access boolean     not null default false,
  -- Operator's real granted tasks (e.g. {DRAFT,ANALYZE,ADVERTISE,MANAGE}).
  user_tasks      text[]      not null default '{}',
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  unique (business_id, ad_account_id)
);

comment on table bm_ad_accounts is
  'Every ad account seen under a connected BM (owned_ad_accounts + client_ad_accounts). user_has_access = the operator holds a direct assigned_users role. Migration 147.';
comment on column bm_ad_accounts.ad_account_id is
  'Meta node id, "act_"-prefixed — the id POST /{id}/assigned_users addresses. account_id holds the bare numeric form.';
comment on column bm_ad_accounts.user_tasks is
  'The operator''s actual granted tasks as read back from Meta. Meta expands grants, so verification is a superset check, never equality.';

create index if not exists idx_bm_ad_accounts_business on bm_ad_accounts (business_id);
create index if not exists idx_bm_ad_accounts_missing_access
  on bm_ad_accounts (business_id) where user_has_access = false;
create index if not exists idx_bm_ad_accounts_first_seen on bm_ad_accounts (first_seen_at desc);

-- ── bm_pixels ───────────────────────────────────────────────────────────────

create table if not exists bm_pixels (
  id                        uuid        primary key default gen_random_uuid(),
  business_id               text        not null references client_business_managers (business_id) on delete cascade,
  pixel_id                  text        not null,
  name                      text,
  -- Valid Graph field but frequently absent from the payload → nullable.
  last_fired_time           timestamptz,
  creation_time             timestamptz,
  is_unavailable            boolean,
  enable_automatic_matching boolean,
  data_use_setting          text,
  is_owned_by_bm            boolean     not null default true,
  user_has_access           boolean     not null default false,
  -- Verified permitted set is {EDIT,ANALYZE,UPLOAD,ADVERTISE,AA_ANALYZE} —
  -- note there is NO MANAGE task on pixels, unlike pages and ad accounts.
  user_tasks                text[]      not null default '{}',
  first_seen_at             timestamptz not null default now(),
  last_seen_at              timestamptz not null default now(),
  unique (business_id, pixel_id)
);

comment on table bm_pixels is
  'Every Meta pixel/dataset seen under a connected BM (owned_pixels + client_pixels). Migration 147.';
comment on column bm_pixels.user_tasks is
  'Operator''s granted pixel tasks. Verified permitted set: EDIT, ANALYZE, UPLOAD, ADVERTISE, AA_ANALYZE — pixels have NO MANAGE task.';

create index if not exists idx_bm_pixels_business on bm_pixels (business_id);
create index if not exists idx_bm_pixels_missing_access
  on bm_pixels (business_id) where user_has_access = false;
create index if not exists idx_bm_pixels_first_seen on bm_pixels (first_seen_at desc);

-- ── bm_ig_accounts ──────────────────────────────────────────────────────────

create table if not exists bm_ig_accounts (
  id                uuid        primary key default gen_random_uuid(),
  business_id       text        not null references client_business_managers (business_id) on delete cascade,
  -- BUSINESS ASSET id (Graph `id` on owned_/client_instagram_assets). Grants
  -- address THIS id, never ig_user_id.
  ig_asset_id       text        not null,
  -- IG user id (Graph `ig_user_id`) — the id the ads/wizard side joins on.
  ig_user_id        text,
  ig_username       text,
  profile_pic_url   text,
  followers         integer,
  media_count       integer,
  is_owned_by_bm    boolean     not null default true,
  user_has_access   boolean     not null default false,
  -- Observed real values: ADVERTISE, ANALYZE, CONTENT, MESSAGES,
  -- COMMUNITY_ACTIVITY, CREATIVE_MANAGEMENT, CREATOR_MANAGEMENT, FULL_CONTROL.
  -- IG assets do NOT expose a permitted_tasks field at all.
  user_tasks        text[]      not null default '{}',
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  unique (business_id, ig_asset_id)
);

comment on table bm_ig_accounts is
  'Every Instagram business asset seen under a connected BM (owned_instagram_assets + client_instagram_assets — note: client_instagram_ACCOUNTS does not exist). Migration 147.';
comment on column bm_ig_accounts.ig_asset_id is
  'Instagram BUSINESS ASSET id. Grants address this id. Distinct from ig_user_id — the two are not interchangeable.';
comment on column bm_ig_accounts.user_tasks is
  'Operator''s granted IG tasks. Meta EXPANDS an ADVERTISE grant into ADVERTISE+ANALYZE+CONTENT+MESSAGES+COMMUNITY_ACTIVITY (verified live).';

create index if not exists idx_bm_ig_accounts_business on bm_ig_accounts (business_id);
create index if not exists idx_bm_ig_accounts_missing_access
  on bm_ig_accounts (business_id) where user_has_access = false;
create index if not exists idx_bm_ig_accounts_first_seen on bm_ig_accounts (first_seen_at desc);
create index if not exists idx_bm_ig_accounts_ig_user on bm_ig_accounts (ig_user_id);

-- ── generalise bm_page_access_events to any asset type ──────────────────────
--
-- The table keeps its (now slightly historical) name so migration-145 readers
-- and the existing detected_new inbox query keep working untouched. New columns:
--
--   asset_type — 'page' | 'ad_account' | 'pixel' | 'ig_account'
--   asset_id   — the asset's Meta id, whatever its type
--
-- page_id is backfilled into asset_id and relaxed to nullable so non-page rows
-- don't have to fake one. Page rows continue to populate BOTH columns, so the
-- V1 queries that filter on page_id are unaffected.

alter table bm_page_access_events
  add column if not exists asset_type text not null default 'page';
alter table bm_page_access_events
  add column if not exists asset_id text;

update bm_page_access_events
   set asset_id = page_id
 where asset_id is null;

alter table bm_page_access_events alter column page_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bm_page_access_events_asset_type_check'
  ) then
    alter table bm_page_access_events
      add constraint bm_page_access_events_asset_type_check
      check (asset_type in ('page', 'ad_account', 'pixel', 'ig_account'));
  end if;

  -- Every row must identify its asset one way or another.
  if not exists (
    select 1 from pg_constraint
    where conname = 'bm_page_access_events_asset_id_present_check'
  ) then
    alter table bm_page_access_events
      add constraint bm_page_access_events_asset_id_present_check
      check (asset_id is not null or page_id is not null);
  end if;
end $$;

comment on column bm_page_access_events.asset_type is
  'page | ad_account | pixel | ig_account. Defaults to ''page'' so migration-145 rows and readers are unaffected. Migration 147.';
comment on column bm_page_access_events.asset_id is
  'The asset''s Meta id regardless of type. Backfilled from page_id for pre-147 rows; page rows populate both. Migration 147.';

create index if not exists idx_bm_page_access_events_asset
  on bm_page_access_events (business_id, asset_type, asset_id);
create index if not exists idx_bm_page_access_events_type_detected_new
  on bm_page_access_events (asset_type, at desc) where action = 'detected_new';

-- ── RLS — authenticated read, service-role write (mirrors migration 145) ────

alter table bm_ad_accounts enable row level security;
alter table bm_pixels      enable row level security;
alter table bm_ig_accounts enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['bm_ad_accounts', 'bm_pixels', 'bm_ig_accounts']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = 'authenticated read ' || t
    ) then
      execute format(
        'create policy %I on %I for select to authenticated using (true)',
        'authenticated read ' || t, t
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
