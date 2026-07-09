-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 145 — Business Manager Asset Sync (V1: Pages only)
--
-- Backs the /business-managers operator tool. Matas is Admin on ~10+
-- client Business Managers but Meta does not grant BM Admins per-page asset-user
-- access implicitly. This schema lets the tool:
--   (a) enumerate every page across the BMs he is connected to,
--   (b) flag pages where he has no direct user_permissions,
--   (c) one-click grant himself ADVERTISER role,
--   (d) run a daily cron to detect newly-added pages and flag them.
--
-- Tables:
--   1. client_business_managers — one row per BM Matas has connected, holding the
--      encrypted user OAuth token used to enumerate + grant.
--   2. bm_pages                  — every page seen under a BM, with the direct
--      user-access flag the flagging UI keys off.
--   3. bm_page_access_events     — append-only audit of grants / revokes /
--      new-page detections / sync errors.
--
-- Encryption: pgcrypto with a DEDICATED BM_TOKEN_KEY (app env, passed into the
-- RPCs — never stored). A separate key from D2C_TOKEN_KEY / LANDING_PAGES_TOKEN_KEY
-- for blast-radius isolation (same convention as the landing-page arc).
--
-- RLS: operator dashboard data — authenticated read (the app is invite-only, all
-- authenticated users are operators). No INSERT/UPDATE/DELETE policies: every
-- write goes through the service-role client in the API routes / cron (which
-- verify a cookie session + operator allowlist first) or through the SECURITY
-- DEFINER credential RPCs. Same shape as cron_health_reports (migration 124) +
-- the client-dashboard "admin writes are service-role" pattern.
--
-- Reversibility:
--   drop table if exists bm_page_access_events;
--   drop table if exists bm_pages;
--   drop table if exists client_business_managers;
--   drop function if exists set_bm_access_token(uuid, text, text);
--   drop function if exists get_bm_access_token(uuid, text);
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: `if not exists` + catalog-checked DO blocks throughout.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── client_business_managers ────────────────────────────────────────────────

create table if not exists client_business_managers (
  id                     uuid        primary key default gen_random_uuid(),
  -- Nullable: BMs are discovered from /me/businesses before they are mapped to a
  -- CRM client. Operator can associate later. FK set null so deleting a client
  -- never orphans the BM connection.
  client_id              uuid        references clients (id) on delete set null,
  business_id            text        not null unique,
  business_name          text,
  added_by_user_id       uuid        references auth.users (id) on delete set null,
  -- pgp_sym_encrypt(user_oauth_token, BM_TOKEN_KEY). Never selected into API
  -- responses. Written only via set_bm_access_token.
  access_token_encrypted bytea,
  scopes                 text[]      not null default '{}',
  -- Set true on Meta subcode 190 (invalid/expired token). Surfaces the reconnect
  -- banner in the UI; cleared on the next successful connect.
  token_expired          boolean     not null default false,
  last_scanned_at        timestamptz,
  last_error             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table client_business_managers is
  'One row per Business Manager Matas has connected. Holds the encrypted user OAuth token (BM_TOKEN_KEY) used to enumerate owned/client pages and grant himself ADVERTISER access. Migration 145.';
comment on column client_business_managers.access_token_encrypted is
  'pgp_sym_encrypt(user_oauth_token, BM_TOKEN_KEY). Written via set_bm_access_token; read via get_bm_access_token. Never selected raw.';
comment on column client_business_managers.token_expired is
  'Set true on Meta subcode 190. UI shows a reconnect banner; cleared on next successful connect.';

create index if not exists idx_client_business_managers_client
  on client_business_managers (client_id);

-- ── bm_pages ────────────────────────────────────────────────────────────────

create table if not exists bm_pages (
  id             uuid        primary key default gen_random_uuid(),
  business_id    text        not null references client_business_managers (business_id) on delete cascade,
  page_id        text        not null,
  page_name      text,
  category       text,
  is_owned_by_bm boolean     not null default true,
  user_has_access boolean    not null default false,
  followers      integer,
  avatar_url     text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (business_id, page_id)
);

comment on table bm_pages is
  'Every Facebook Page seen under a connected BM. user_has_access = Matas holds a direct user_permissions role on the page (the flag the "missing access" UI keys off). Migration 145.';

create index if not exists idx_bm_pages_business on bm_pages (business_id);
create index if not exists idx_bm_pages_missing_access
  on bm_pages (business_id) where user_has_access = false;
create index if not exists idx_bm_pages_first_seen on bm_pages (first_seen_at desc);

-- ── bm_page_access_events ────────────────────────────────────────────────────

create table if not exists bm_page_access_events (
  id          uuid        primary key default gen_random_uuid(),
  business_id text        not null,
  page_id     text        not null,
  user_id     uuid        references auth.users (id) on delete set null,
  action      text        not null check (action in ('granted', 'revoked', 'detected_new', 'sync_error')),
  detail      jsonb       not null default '{}'::jsonb,
  at          timestamptz not null default now()
);

comment on table bm_page_access_events is
  'Append-only audit of BM page access changes: granted / revoked / detected_new / sync_error. Migration 145.';

create index if not exists idx_bm_page_access_events_recent
  on bm_page_access_events (at desc);
create index if not exists idx_bm_page_access_events_business_page
  on bm_page_access_events (business_id, page_id);
create index if not exists idx_bm_page_access_events_detected_new
  on bm_page_access_events (at desc) where action = 'detected_new';

-- ── updated_at trigger for client_business_managers ──────────────────────────

create or replace function set_client_business_managers_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists client_business_managers_set_updated_at on client_business_managers;
create trigger client_business_managers_set_updated_at
  before update on client_business_managers
  for each row execute function set_client_business_managers_updated_at();

-- ── RLS — authenticated read, service-role write ─────────────────────────────

alter table client_business_managers enable row level security;
alter table bm_pages                 enable row level security;
alter table bm_page_access_events    enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_business_managers'
      and policyname = 'authenticated read business managers'
  ) then
    execute
      'create policy "authenticated read business managers" '
      'on client_business_managers for select to authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bm_pages'
      and policyname = 'authenticated read bm pages'
  ) then
    execute
      'create policy "authenticated read bm pages" '
      'on bm_pages for select to authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bm_page_access_events'
      and policyname = 'authenticated read bm page access events'
  ) then
    execute
      'create policy "authenticated read bm page access events" '
      'on bm_page_access_events for select to authenticated using (true)';
  end if;
end $$;

-- ── set_bm_access_token ──────────────────────────────────────────────────────
-- Encrypts the user OAuth token into access_token_encrypted and clears the
-- token_expired flag. SECURITY DEFINER; allows service_role (routes / cron) or
-- the row's added_by_user_id.

create or replace function set_bm_access_token(
  p_id uuid,
  p_token text,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_allowed boolean := false;
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'BM_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_token is null or length(p_token) < 8 then
    raise exception 'access token is required';
  end if;

  select added_by_user_id into v_owner
    from client_business_managers where id = p_id;
  if not found then
    raise exception 'business manager % not found', p_id;
  end if;

  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    v_allowed := true;
  elsif auth.uid() is not null and (v_owner is null or auth.uid() = v_owner) then
    v_allowed := true;
  end if;
  if not v_allowed then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update client_business_managers
     set access_token_encrypted = pgp_sym_encrypt(p_token, p_key),
         token_expired          = false,
         updated_at             = now()
   where id = p_id;
end;
$$;

comment on function set_bm_access_token(uuid, text, text) is
  'Encrypts a user OAuth token into client_business_managers.access_token_encrypted and clears token_expired. SECURITY DEFINER; service_role or the row owner only.';

-- ── get_bm_access_token ──────────────────────────────────────────────────────
-- Decrypts access_token_encrypted for scan / grant. Allows service_role (cron)
-- or the row's added_by_user_id.

create or replace function get_bm_access_token(
  p_id uuid,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blob bytea;
  v_owner uuid;
  v_allowed boolean := false;
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'BM_TOKEN_KEY must be set and at least 8 characters';
  end if;

  select access_token_encrypted, added_by_user_id
    into v_blob, v_owner
    from client_business_managers
   where id = p_id;

  if not found then
    return null;
  end if;

  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    v_allowed := true;
  elsif auth.uid() is not null and (v_owner is null or auth.uid() = v_owner) then
    v_allowed := true;
  end if;
  if not v_allowed then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if v_blob is null then
    return null;
  end if;
  return pgp_sym_decrypt(v_blob, p_key);
end;
$$;

comment on function get_bm_access_token(uuid, text) is
  'Decrypts client_business_managers.access_token_encrypted. SECURITY DEFINER; service_role (cron) or the row owner only.';

revoke all on function set_bm_access_token(uuid, text, text) from public;
revoke all on function get_bm_access_token(uuid, text) from public;
grant execute on function set_bm_access_token(uuid, text, text) to authenticated;
grant execute on function set_bm_access_token(uuid, text, text) to service_role;
grant execute on function get_bm_access_token(uuid, text) to authenticated;
grant execute on function get_bm_access_token(uuid, text) to service_role;

notify pgrst, 'reload schema';
