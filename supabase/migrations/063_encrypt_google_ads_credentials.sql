-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 060 — Encrypt Google Ads OAuth credentials at rest.
--
-- Mirrors migration 054's pgcrypto pattern for TikTok credentials, but targets
-- `google_ads_accounts`. New OAuth writes store refresh/access-token JSON in
-- credentials_encrypted via set_google_ads_credentials(); the legacy
-- access_token_encrypted text placeholder, where present, is intentionally left
-- null on new writes and should be removed in a follow-up cleanup PR after
-- production verification.
--
-- Encryption key:
--   GOOGLE_ADS_TOKEN_KEY is read from current_setting(
--   'app.settings.google_ads_token_key', true) when configured by PostgREST.
--   If absent, the RPC falls back to Supabase Vault secret
--   GOOGLE_ADS_TOKEN_KEY. A p_key argument remains available for local tests
--   and one-off admin scripts, but application callers should rely on env /
--   Vault wiring.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

alter table google_ads_accounts
  add column if not exists credentials_encrypted bytea,
  add column if not exists credentials_format    text not null default 'v1',
  add column if not exists login_customer_id     text;

comment on column google_ads_accounts.credentials_encrypted is
  'pgp_sym_encrypt(plaintext_json::text, GOOGLE_ADS_TOKEN_KEY) — never decrypted server-side except via get_google_ads_credentials(). Replaces the legacy access_token_encrypted placeholder for new writes.';
comment on column google_ads_accounts.credentials_format is
  'Schema version of the encrypted JSON payload. v1 = Google OAuth token response + customer/login customer ids.';
comment on column google_ads_accounts.login_customer_id is
  'Manager account id used as login-customer-id for Google Ads API calls. Default MCC for this rollout is 333-703-8088.';
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'clients'
       and column_name = 'google_ads_account_id'
  ) then
    alter table clients
      add column google_ads_account_id uuid
        references google_ads_accounts (id) on delete set null;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'clients_google_ads_account_id_fkey'
       and conrelid = 'public.clients'::regclass
  ) then
    alter table clients
      add constraint clients_google_ads_account_id_fkey
      foreign key (google_ads_account_id)
      references google_ads_accounts (id)
      on delete set null;
  end if;

  create index if not exists clients_google_ads_account_id_idx
    on clients (google_ads_account_id);

  comment on column clients.google_ads_account_id is
    'Default Google Ads account for this client''s events. Per-event override lives on events.google_ads_account_id.';
end;
$$;

-- ── set_google_ads_credentials ─────────────────────────────────────────────

create or replace function set_google_ads_credentials(
  p_account_id uuid,
  p_plaintext  text,
  p_key        text default null
)
returns void
language plpgsql
security invoker
as $$
declare
  v_key text;
begin
  if p_plaintext is null or length(p_plaintext) = 0 then
    raise exception 'plaintext credentials are required';
  end if;

  v_key := nullif(p_key, '');
  if v_key is null then
    v_key := nullif(current_setting('app.settings.google_ads_token_key', true), '');
  end if;
  if v_key is null and to_regnamespace('vault') is not null then
    execute
      'select decrypted_secret from vault.decrypted_secrets where name = $1 order by updated_at desc nulls last limit 1'
      into v_key
      using 'GOOGLE_ADS_TOKEN_KEY';
  end if;
  if v_key is null or length(v_key) < 8 then
    raise exception 'GOOGLE_ADS_TOKEN_KEY must be set and at least 8 characters';
  end if;

  update google_ads_accounts
     set credentials_encrypted = pgp_sym_encrypt(p_plaintext, v_key),
         credentials_format    = 'v1',
         updated_at            = now()
   where id = p_account_id;

  if not found then
    raise exception 'Google Ads account % not found or not owned by current user', p_account_id;
  end if;
end;
$$;

comment on function set_google_ads_credentials(uuid, text, text) is
  'Encrypts plaintext Google Ads OAuth credentials JSON and stores it in google_ads_accounts.credentials_encrypted. SECURITY INVOKER + RLS ensure callers can only update rows they own. The key is resolved from PostgREST settings or Supabase Vault unless explicitly supplied for tests/admin scripts.';

-- ── get_google_ads_credentials ─────────────────────────────────────────────

create or replace function get_google_ads_credentials(
  p_account_id uuid,
  p_key        text default null
)
returns text
language plpgsql
security invoker
as $$
declare
  v_blob bytea;
  v_key text;
begin
  select credentials_encrypted
    into v_blob
    from google_ads_accounts
   where id = p_account_id;

  if v_blob is null then
    return null;
  end if;

  v_key := nullif(p_key, '');
  if v_key is null then
    v_key := nullif(current_setting('app.settings.google_ads_token_key', true), '');
  end if;
  if v_key is null and to_regnamespace('vault') is not null then
    execute
      'select decrypted_secret from vault.decrypted_secrets where name = $1 order by updated_at desc nulls last limit 1'
      into v_key
      using 'GOOGLE_ADS_TOKEN_KEY';
  end if;
  if v_key is null or length(v_key) < 8 then
    raise exception 'GOOGLE_ADS_TOKEN_KEY must be set and at least 8 characters';
  end if;

  return pgp_sym_decrypt(v_blob, v_key)::text;
end;
$$;

comment on function get_google_ads_credentials(uuid, text) is
  'Returns decrypted Google Ads credentials JSON for one account. Returns null when the row has no encrypted blob. Throws on key mismatch or corrupt blob so callers can surface a reconnect prompt.';

grant execute on function set_google_ads_credentials(uuid, text, text) to authenticated;
grant execute on function get_google_ads_credentials(uuid, text)       to authenticated;

notify pgrst, 'reload schema';
