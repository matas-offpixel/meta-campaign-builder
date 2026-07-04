-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 135 — landing-page Meta CAPI support (PR 3 of the landing-page
-- arc: per-client Meta Pixel + Conversions API).
--
-- 1. `client_landing_pages.meta_test_event_code` — per-client Meta CAPI
--    test event code (Events Manager → Test Events). Set via SQL for QA,
--    cleared for prod. DEV-ONLY: leaving it set routes events to the Test
--    Events surface instead of the live pixel dataset.
-- 2. `client_landing_pages.meta_pixel_id_verified_at` — admin flag: when
--    Matas last confirmed the pixel receives events. Surfaced as stale
--    state by the PR-5 admin dashboard; no runtime behaviour attached.
-- 3. `set/get_landing_page_capi_token` — SECURITY DEFINER accessors for
--    `meta_capi_token_encrypted`, exactly the shape the PR-1 design doc
--    prescribed (§2). The raw blob is NEVER selected into app code: the
--    signup route calls get_ (decrypt at send time), ops set tokens via
--    set_. Key = LANDING_PAGES_TOKEN_KEY (same key as event_signups PII —
--    one key per arc, design doc §8), passed per call, never stored.
--
-- PGCRYPTO SCHEMA LANDMINE (see migration 134 + MIGRATIONS_NOTES): pgcrypto
-- has lived in BOTH `public` and `extensions` on prod within one week.
-- Both accessors set `search_path = public, extensions` and call pgp_sym_*
-- UNQUALIFIED so either placement works. Never single-schema-qualify.
--
-- Reversibility:
--   alter table client_landing_pages drop column if exists meta_test_event_code;
--   alter table client_landing_pages drop column if exists meta_pixel_id_verified_at;
--   drop function if exists set_landing_page_capi_token(uuid, text, text);
--   drop function if exists get_landing_page_capi_token(uuid, text);
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: every statement is `if not exists` / `create or replace`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table client_landing_pages
  add column if not exists meta_test_event_code text;

alter table client_landing_pages
  add column if not exists meta_pixel_id_verified_at timestamptz;

comment on column client_landing_pages.meta_test_event_code is
  'Meta CAPI test event code (Events Manager > Test Events). DEV/QA ONLY — when set, landing-page CAPI events carry test_event_code and land in the Test Events surface, not live reporting. Clear after QA. PR-5 admin UI must warn loudly when non-null.';

comment on column client_landing_pages.meta_pixel_id_verified_at is
  'When the operator last confirmed this client''s pixel receives landing-page events (manual flag, set via SQL until the PR-5 admin dashboard). Stale/null = unverified; no runtime behaviour.';

-- ── CAPI token accessors ─────────────────────────────────────────────────────

create or replace function set_landing_page_capi_token(
  p_client_id uuid,
  p_token text,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'LANDING_PAGES_TOKEN_KEY must be set and at least 8 characters';
  end if;
  update client_landing_pages
     set meta_capi_token_encrypted = case
           when p_token is null then null
           else pgp_sym_encrypt(p_token, p_key)
         end,
         updated_at = now()
   where client_id = p_client_id;
  if not found then
    raise exception 'no client_landing_pages row for client %', p_client_id;
  end if;
end;
$$;

create or replace function get_landing_page_capi_token(
  p_client_id uuid,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_blob bytea;
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'LANDING_PAGES_TOKEN_KEY must be set and at least 8 characters';
  end if;
  select meta_capi_token_encrypted into v_blob
    from client_landing_pages
   where client_id = p_client_id;
  if v_blob is null then
    return null;
  end if;
  return pgp_sym_decrypt(v_blob, p_key);
end;
$$;

comment on function set_landing_page_capi_token(uuid, text, text) is
  'Encrypt + store a client''s Meta CAPI token (LANDING_PAGES_TOKEN_KEY). service_role only. Ops usage: select set_landing_page_capi_token(''<client uuid>'', ''<token>'', ''<key>'');';
comment on function get_landing_page_capi_token(uuid, text) is
  'Decrypt a client''s Meta CAPI token at send time. service_role only — never expose through PR-5 admin UI as cleartext-at-rest; decrypt on demand only.';

revoke all on function set_landing_page_capi_token(uuid, text, text) from public;
revoke all on function get_landing_page_capi_token(uuid, text) from public;
revoke all on function set_landing_page_capi_token(uuid, text, text) from anon, authenticated;
revoke all on function get_landing_page_capi_token(uuid, text) from anon, authenticated;
grant execute on function set_landing_page_capi_token(uuid, text, text) to service_role;
grant execute on function get_landing_page_capi_token(uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block — raises inside the migration transaction on any miss.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_count int;
  v_probe text;
begin
  -- Both new columns exist with the right types.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'client_landing_pages'
    and (
      (column_name = 'meta_test_event_code' and data_type = 'text')
      or (column_name = 'meta_pixel_id_verified_at'
          and data_type = 'timestamp with time zone')
    );
  if v_count <> 2 then
    raise exception 'migration 135 verification: expected both new columns, found %', v_count;
  end if;

  -- RLS from migration 132 still holds on client_landing_pages.
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'client_landing_pages'
    and c.relrowsecurity;
  if v_count <> 1 then
    raise exception 'migration 135 verification: RLS not enabled on client_landing_pages';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'client_landing_pages'
    and policyname = 'owner manage client landing pages';
  if v_count <> 1 then
    raise exception 'migration 135 verification: migration-132 owner policy missing';
  end if;

  -- Accessors exist and execute (unknown client id → get returns null;
  -- exercises the SECURITY DEFINER + search_path wiring live).
  select get_landing_page_capi_token(gen_random_uuid(), 'migration-135-probe-key')
    into v_probe;
  if v_probe is not null then
    raise exception 'migration 135 verification: get accessor returned a value for a random client id';
  end if;

  -- pgcrypto reachable through the 134 helpers (either schema) — the same
  -- functions the send-time decrypt path uses.
  select landing_page_decrypt(
           landing_page_encrypt('capi-probe', 'migration-135-probe-key'),
           'migration-135-probe-key'
         )
    into v_probe;
  if v_probe is distinct from 'capi-probe' then
    raise exception 'migration 135 verification: pgcrypto round trip failed (got %)', v_probe;
  end if;

  raise notice 'migration 135 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
