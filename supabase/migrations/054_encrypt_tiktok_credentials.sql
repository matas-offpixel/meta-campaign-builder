-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 054 — Encrypt TikTok Business API credentials at rest.
--
-- Mirrors migration 038's pgcrypto pattern for Eventbrite credentials, but
-- targets `tiktok_accounts`. New OAuth writes store an opaque JSON payload in
-- credentials_encrypted via set_tiktok_credentials(); the legacy
-- access_token_encrypted text column is intentionally left null on new writes
-- and will be cleaned up in a follow-up after production verification.
--
-- Encryption key:
--   TIKTOK_TOKEN_KEY lives in process env and is passed into the RPC at call
--   time. It is never persisted, logged, or returned to clients.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

alter table tiktok_accounts
  add column if not exists credentials_encrypted bytea,
  add column if not exists credentials_format    text not null default 'v1';

comment on column tiktok_accounts.credentials_encrypted is
  'pgp_sym_encrypt(plaintext_json::text, TIKTOK_TOKEN_KEY) — never decrypted server-side except via get_tiktok_credentials() with the env-loaded key. Replaces the legacy access_token_encrypted placeholder for new writes.';
comment on column tiktok_accounts.credentials_format is
  'Schema version of the encrypted JSON payload. v1 = TikTok Business OAuth access-token response + advertiser_ids.';

-- ── set_tiktok_credentials ─────────────────────────────────────────────────

create or replace function set_tiktok_credentials(
  p_account_id uuid,
  p_plaintext  text,
  p_key        text
)
returns void
language plpgsql
security invoker
as $$
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'TIKTOK_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_plaintext is null or length(p_plaintext) = 0 then
    raise exception 'plaintext credentials are required';
  end if;

  update tiktok_accounts
     set credentials_encrypted = pgp_sym_encrypt(p_plaintext, p_key),
         credentials_format    = 'v1',
         -- Do not populate the legacy text placeholder on new writes.
         access_token_encrypted = null,
         updated_at            = now()
   where id = p_account_id;

  if not found then
    raise exception 'TikTok account % not found or not owned by current user', p_account_id;
  end if;
end;
$$;

comment on function set_tiktok_credentials(uuid, text, text) is
  'Encrypts plaintext TikTok credentials JSON and stores it in tiktok_accounts.credentials_encrypted. SECURITY INVOKER + RLS ensure callers can only update rows they own. The key parameter is never persisted.';

-- ── get_tiktok_credentials ─────────────────────────────────────────────────

create or replace function get_tiktok_credentials(
  p_account_id uuid,
  p_key        text
)
returns text
language plpgsql
security invoker
as $$
declare
  v_blob bytea;
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'TIKTOK_TOKEN_KEY must be set and at least 8 characters';
  end if;

  select credentials_encrypted
    into v_blob
    from tiktok_accounts
   where id = p_account_id;

  if v_blob is null then
    return null;
  end if;

  return pgp_sym_decrypt(v_blob, p_key)::text;
end;
$$;

comment on function get_tiktok_credentials(uuid, text) is
  'Returns decrypted TikTok credentials JSON for one account. Returns null when the row has no encrypted blob. Throws on key mismatch or corrupt blob so callers can surface a reconnect prompt.';

grant execute on function set_tiktok_credentials(uuid, text, text) to authenticated;
grant execute on function get_tiktok_credentials(uuid, text)       to authenticated;

notify pgrst, 'reload schema';
