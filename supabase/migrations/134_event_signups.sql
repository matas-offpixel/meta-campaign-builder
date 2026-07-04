-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 134 — event_signups + landing-page crypto helpers + template_key
-- promotion (PR 2 of the landing-page arc: theming + on-page signup form).
--
-- 1. `event_signups` — fan signups captured by the /l signup form. PII
--    (email, phone) is stored ONLY as pgcrypto blobs + salted sha256 hashes
--    (hashes power per-event dedupe without decryption). Raw IP is never
--    stored — ip_hash only.
-- 2. `landing_page_encrypt` / `landing_page_decrypt` — SECURITY DEFINER
--    pgp_sym wrappers. Key = LANDING_PAGES_TOKEN_KEY (app env, passed as an
--    argument, never stored) — deliberately NOT D2C_TOKEN_KEY, see the
--    design doc's key-strategy section.
-- 3. `page_events.template_key` — promotes the PR-1 jsonb ride-along
--    (content.template_key) to a real FK column, per the PR-2 contract row
--    in docs/LANDING_PAGE_ARCHITECTURE.md.
--
-- PGCRYPTO SCHEMA LANDMINE (updated 2026-07-04): pgcrypto has now lived in
-- BOTH schemas on prod within one week — `extensions` (migration 131,
-- 2026-07-01 morning) and `public` (ops fix during the D2C direct-fire
-- incident, 2026-07-01 night; verified live 2026-07-04). Nothing here may
-- assume either placement: both crypto functions set
-- `search_path = public, extensions` so unqualified pgp_sym_* resolves
-- wherever the extension actually is, and the verification block probes
-- BOTH qualified names and requires at least one to work.
--
-- Dedupe model (resolves a spec conflict — see design doc):
--   * CANONICAL rows carry PII + hashes. One per (event_id, email_hash) and
--     per (event_id, phone_hash) — enforced by partial unique indexes that
--     apply ONLY to canonical rows.
--   * REPEAT signups insert an attribution-only row: deduplicated_signup_id
--     points at the canonical row; NO PII, NO hashes are re-stored. The
--     contactable CHECK exempts these rows.
--
-- Reversibility:
--   drop table if exists event_signups;
--   drop function if exists landing_page_encrypt(text, text);
--   drop function if exists landing_page_decrypt(bytea, text);
--   alter table page_events drop column if exists template_key;
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: every statement is `if not exists` or catalog-checked.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── page_events.template_key promotion ──────────────────────────────────────

alter table page_events
  add column if not exists template_key text references page_templates (key);

update page_events
   set template_key = coalesce(nullif(content ->> 'template_key', ''), 'mvp_v1')
 where template_key is null;

alter table page_events
  alter column template_key set default 'mvp_v1';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'page_events'
      and column_name = 'template_key'
      and is_nullable = 'YES'
  ) then
    alter table page_events alter column template_key set not null;
  end if;
end $$;

comment on column page_events.template_key is
  'Which page_templates row renders this page. Promoted from content.template_key (PR 1 ride-along) in migration 134; readers should prefer this column, content.template_key is legacy.';

-- ── event_signups ────────────────────────────────────────────────────────────

create table if not exists event_signups (
  id                      uuid        primary key default gen_random_uuid(),
  event_id                uuid        not null references events (id)  on delete cascade,
  -- Denormalised for RLS + isolation queries. MUST equal
  -- events.client_id — enforced by the trigger below (a CHECK cannot
  -- reference another table).
  client_id               uuid        not null references clients (id) on delete cascade,
  first_name              text,
  last_name               text,
  -- PII: pgp_sym_encrypt(value, LANDING_PAGES_TOKEN_KEY). Never plaintext.
  email_encrypted         bytea,
  -- sha256(namespaced salt + normalised value) — dedupe without decryption.
  -- Not reversible; NOT usable for cross-event tracking without the salt.
  email_hash              text,
  phone_encrypted         bytea,
  phone_hash              text,
  -- Unencrypted ISO country ('GB', 'ES') for aggregate analytics only.
  phone_country_code      text,
  city                    text,
  -- Lowercased, @ stripped (normalised app-side, shared schema module).
  ig_handle               text,
  tt_handle               text,
  consent_gdpr_at         timestamptz not null,
  consent_wa_opt_in_at    timestamptz,
  source                  text,
  utm                     jsonb       not null default '{}'::jsonb,
  referrer_url            text,
  -- sha256(ip + salt). Raw IP is NEVER stored (GDPR data minimisation).
  ip_hash                 text,
  user_agent              text,
  -- Repeat-signup marker: points at the canonical row for this fan+event.
  -- Repeat rows are attribution-only — no PII, no hashes.
  deduplicated_signup_id  uuid        references event_signups (id) on delete set null,
  created_at              timestamptz not null default now(),

  -- A signup we cannot contact is invalid (Laylo's deliverability failure
  -- mode). Repeat rows are exempt — their canonical row is contactable.
  constraint event_signups_contactable_check check (
    email_encrypted is not null
    or phone_encrypted is not null
    or deduplicated_signup_id is not null
  ),
  -- Hash and blob travel together — a blob without its dedupe hash (or
  -- vice versa) is a write-path bug.
  constraint event_signups_email_pair_check check (
    (email_encrypted is null) = (email_hash is null)
  ),
  constraint event_signups_phone_pair_check check (
    (phone_encrypted is null) = (phone_hash is null)
  )
);

comment on table event_signups is
  'Fan signups from the internal landing pages (/l). PII encrypted with LANDING_PAGES_TOKEN_KEY (pgcrypto), deduped per event via salted hashes. Repeat signups are attribution-only rows pointing at the canonical row. Migration 134.';

-- One CANONICAL row per (event, email) / (event, phone). Repeat rows
-- (deduplicated_signup_id not null) are exempt by design.
create unique index if not exists event_signups_event_email_uidx
  on event_signups (event_id, email_hash)
  where email_hash is not null and deduplicated_signup_id is null;

create unique index if not exists event_signups_event_phone_uidx
  on event_signups (event_id, phone_hash)
  where phone_hash is not null and deduplicated_signup_id is null;

create index if not exists event_signups_event_created_idx
  on event_signups (event_id, created_at desc);

create index if not exists event_signups_client_created_idx
  on event_signups (client_id, created_at desc);

-- ── client_id ↔ event.client_id integrity trigger ───────────────────────────

create or replace function enforce_event_signup_client_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_client uuid;
begin
  select client_id into v_client from events where id = new.event_id;
  if v_client is null then
    raise exception 'event_signups: event % not found', new.event_id;
  end if;
  if new.client_id is distinct from v_client then
    raise exception
      'event_signups: client_id % does not match events.client_id % for event % — tenant mismatch is a privacy bug',
      new.client_id, v_client, new.event_id;
  end if;
  return new;
end;
$$;

drop trigger if exists event_signups_client_match on event_signups;
create trigger event_signups_client_match
  before insert or update on event_signups
  for each row execute function enforce_event_signup_client_match();

-- ── RLS — owner read via the events chain; writes service-role only ─────────

alter table event_signups enable row level security;

-- Mirrors PR 1's page_events policy pivot exactly (events.user_id). No
-- INSERT/UPDATE/DELETE policies: anonymous fans cannot write through
-- PostgREST — signup writes go through the API route's service-role client,
-- which is where validation, hashing, captcha, and rate limiting live.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'event_signups'
      and policyname = 'owner read event signups'
  ) then
    execute
      'create policy "owner read event signups" '
      'on event_signups for select '
      'using (exists (select 1 from events e '
      'where e.id = event_signups.event_id '
      'and e.user_id = auth.uid()))';
  end if;
end $$;

-- ── Crypto helpers (schema-agnostic pgcrypto) ────────────────────────────────

create or replace function landing_page_encrypt(p_plaintext text, p_key text)
returns bytea
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'LANDING_PAGES_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_plaintext is null then
    return null;
  end if;
  -- Unqualified on purpose: search_path covers pgcrypto in EITHER public
  -- (current prod, ops fix 2026-07-01 night) or extensions (migration 131
  -- placement). Do not schema-qualify — that re-introduces the assumption.
  return pgp_sym_encrypt(p_plaintext, p_key);
end;
$$;

create or replace function landing_page_decrypt(p_blob bytea, p_key text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'LANDING_PAGES_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_blob is null then
    return null;
  end if;
  return pgp_sym_decrypt(p_blob, p_key);
end;
$$;

comment on function landing_page_encrypt(text, text) is
  'pgp_sym_encrypt wrapper for landing-page PII (LANDING_PAGES_TOKEN_KEY — never the D2C key). search_path = public, extensions so pgcrypto resolves in either schema. service_role execute only.';
comment on function landing_page_decrypt(bytea, text) is
  'Inverse of landing_page_encrypt. service_role execute only — owner-facing decryption UX is a later-PR concern with its own accessor.';

revoke all on function landing_page_encrypt(text, text) from public;
revoke all on function landing_page_decrypt(bytea, text) from public;
revoke all on function landing_page_encrypt(text, text) from anon, authenticated;
revoke all on function landing_page_decrypt(bytea, text) from anon, authenticated;
grant execute on function landing_page_encrypt(text, text) to service_role;
grant execute on function landing_page_decrypt(bytea, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block — raises inside the migration transaction on any miss,
-- so a partial apply is loud and rolls back (PR-1 pattern).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_count int;
  v_probe_ok boolean := false;
  v_roundtrip text;
begin
  -- RLS enabled + owner-read policy present + NO write policies.
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'event_signups' and c.relrowsecurity;
  if v_count <> 1 then
    raise exception 'migration 134 verification: RLS not enabled on event_signups';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'event_signups'
    and policyname = 'owner read event signups' and cmd = 'SELECT';
  if v_count <> 1 then
    raise exception 'migration 134 verification: owner read policy missing';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'event_signups' and cmd <> 'SELECT';
  if v_count <> 0 then
    raise exception 'migration 134 verification: event_signups must have no write policies, found %', v_count;
  end if;

  -- CHECK constraints.
  select count(*) into v_count
  from pg_constraint
  where contype = 'c'
    and conrelid = 'public.event_signups'::regclass
    and conname in (
      'event_signups_contactable_check',
      'event_signups_email_pair_check',
      'event_signups_phone_pair_check'
    );
  if v_count <> 3 then
    raise exception 'migration 134 verification: expected 3 CHECK constraints, found %', v_count;
  end if;

  -- Partial unique dedupe indexes.
  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public' and tablename = 'event_signups'
    and indexname in ('event_signups_event_email_uidx', 'event_signups_event_phone_uidx');
  if v_count <> 2 then
    raise exception 'migration 134 verification: expected 2 partial unique indexes, found %', v_count;
  end if;

  -- Tenant-integrity trigger.
  select count(*) into v_count
  from pg_trigger
  where tgrelid = 'public.event_signups'::regclass
    and tgname = 'event_signups_client_match';
  if v_count <> 1 then
    raise exception 'migration 134 verification: client-match trigger missing';
  end if;

  -- template_key promoted + NOT NULL.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'page_events'
    and column_name = 'template_key' and is_nullable = 'NO';
  if v_count <> 1 then
    raise exception 'migration 134 verification: page_events.template_key missing or nullable';
  end if;

  -- pgcrypto reachable under EITHER schema. Probe both qualified names; at
  -- least one must succeed (the functions above use search_path so they
  -- work either way — this assertion documents which world we applied in).
  begin
    perform public.pgp_sym_encrypt('probe', 'migration-134-probe-key');
    v_probe_ok := true;
    raise notice 'migration 134 verification: pgcrypto found in schema PUBLIC';
  exception when undefined_function then
    null;
  end;
  if not v_probe_ok then
    begin
      perform extensions.pgp_sym_encrypt('probe', 'migration-134-probe-key');
      v_probe_ok := true;
      raise notice 'migration 134 verification: pgcrypto found in schema EXTENSIONS';
    exception when undefined_function then
      null;
    end;
  end if;
  if not v_probe_ok then
    raise exception 'migration 134 verification: pgp_sym_encrypt not callable in public OR extensions — pgcrypto missing?';
  end if;

  -- Live encrypt → decrypt round trip through the new helpers.
  select landing_page_decrypt(
           landing_page_encrypt('roundtrip-probe', 'migration-134-probe-key'),
           'migration-134-probe-key'
         )
    into v_roundtrip;
  if v_roundtrip is distinct from 'roundtrip-probe' then
    raise exception 'migration 134 verification: encrypt/decrypt round trip failed (got %)', v_roundtrip;
  end if;

  raise notice 'migration 134 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
