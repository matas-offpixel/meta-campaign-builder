-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 038 — Encrypt ticketing connection credentials at rest.
--
-- Until now `client_ticketing_connections.credentials` has been a plain
-- `jsonb` blob ({ "personal_token": "<eventbrite_oauth_token>" }). With
-- only one user inside Supabase RLS the blast radius was tiny, but a
-- backup leak or an over-broad service-role query would expose live
-- Eventbrite tokens. This migration moves credentials to a pgcrypto
-- symmetric-encrypted bytea column.
--
-- Encryption key:
--   The key lives in process env (`EVENTBRITE_TOKEN_KEY`) and is passed
--   into the RPC as a parameter on every call. It is never persisted in
--   the database, never logged, never returned to the client. The same
--   key is used for every connection regardless of provider — rotation
--   would mean re-saving every connection (re-validate + re-encrypt
--   under the new key). The name carries 'EVENTBRITE_' for historical
--   reasons; if a third provider lands and we want a per-provider key
--   we can branch in the app layer at that point.
--
-- Schema:
--   credentials_encrypted bytea           — pgp_sym_encrypt(text, key)
--   credentials_format    text default v1 — bumps if we change shape
--   credentials           jsonb           — kept around but always {} once
--                                           the encrypted column is set,
--                                           so legacy reads degrade
--                                           cleanly to "no token". A
--                                           later migration will drop it
--                                           after every environment has
--                                           re-saved its connections.
--
-- RPCs (both SECURITY INVOKER, so RLS still applies):
--   set_ticketing_credentials(connection_id, plaintext_json, key)
--     - authenticated callers only
--     - row is fetched through RLS; if not visible/owned the update
--       no-ops and the function raises
--     - plaintext_json is the same shape as the legacy `credentials`
--       column — `{"personal_token":"..."}` for Eventbrite — passed in
--       as text so the JSON shape is opaque to pgcrypto
--     - sets credentials = '{}'::jsonb in the same statement so the
--       plaintext is wiped immediately after migration of an existing
--       row
--
--   get_ticketing_credentials(connection_id, key) returns text
--     - SECURITY INVOKER — RLS keeps each user to their own rows
--     - returns the decrypted JSON string, or null if the row has no
--       encrypted blob yet (legacy rows fall back to the jsonb column
--       in app code)
--     - failure to decrypt (wrong key, corrupt blob) raises rather
--       than returning empty so the caller can surface a clear error
--
-- After applying:
--   1. Set EVENTBRITE_TOKEN_KEY in Vercel (production + preview) +
--      .env.local. Anything random + ≥32 chars is fine — pgcrypto
--      uses CAST5/Blowfish via OpenPGP, the key is stretched
--      internally.
--   2. Re-save each existing Eventbrite connection in the dashboard
--      (Ticketing tab on the client page → trash + re-add). The new
--      POST flow encrypts on save; the old rows stay legible (legacy
--      jsonb path) until they're re-saved.
--   3. Run `supabase gen types` to refresh `lib/db/database.types.ts`
--      so the new column / RPCs land in the typed surface.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

alter table client_ticketing_connections
  add column if not exists credentials_encrypted bytea,
  add column if not exists credentials_format    text not null default 'v1';

comment on column client_ticketing_connections.credentials_encrypted is
  'pgp_sym_encrypt(plaintext_json::text, EVENTBRITE_TOKEN_KEY) — never decrypted server-side except via get_ticketing_credentials() with the env-loaded key. Replaces the legacy `credentials` jsonb column for new writes; old rows keep their plaintext jsonb until re-saved.';
comment on column client_ticketing_connections.credentials_format is
  'Schema version of the encrypted JSON payload. v1 = the same shape used by the legacy credentials jsonb column (e.g. {"personal_token":"..."} for Eventbrite). Bumps on shape change so the read path can branch.';

-- ── set_ticketing_credentials ─────────────────────────────────────────────

create or replace function set_ticketing_credentials(
  p_connection_id uuid,
  p_plaintext     text,
  p_key           text
)
returns void
language plpgsql
security invoker
as $$
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'EVENTBRITE_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_plaintext is null or length(p_plaintext) = 0 then
    raise exception 'plaintext credentials are required';
  end if;

  update client_ticketing_connections
     set credentials_encrypted = pgp_sym_encrypt(p_plaintext, p_key),
         credentials_format    = 'v1',
         -- Wipe the legacy plaintext column the moment we have an
         -- encrypted copy. Anything that still wants the old shape has
         -- to go through get_ticketing_credentials().
         credentials           = '{}'::jsonb,
         updated_at            = now()
   where id = p_connection_id;

  if not found then
    raise exception 'connection % not found or not owned by current user', p_connection_id;
  end if;
end;
$$;

comment on function set_ticketing_credentials(uuid, text, text) is
  'Encrypts plaintext credentials JSON and stores into client_ticketing_connections.credentials_encrypted. Wipes the legacy credentials jsonb column at the same time. SECURITY INVOKER + the standard RLS policy ensure callers can only update rows they own. The key parameter is never persisted.';

-- ── get_ticketing_credentials ─────────────────────────────────────────────

create or replace function get_ticketing_credentials(
  p_connection_id uuid,
  p_key           text
)
returns text
language plpgsql
security invoker
as $$
declare
  v_blob bytea;
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'EVENTBRITE_TOKEN_KEY must be set and at least 8 characters';
  end if;

  select credentials_encrypted
    into v_blob
    from client_ticketing_connections
   where id = p_connection_id;

  -- Either the row is invisible to the caller (RLS) or doesn't exist;
  -- either way we want the API layer to handle the empty case the same
  -- as a missing connection.
  if v_blob is null then
    return null;
  end if;

  return pgp_sym_decrypt(v_blob, p_key)::text;
end;
$$;

comment on function get_ticketing_credentials(uuid, text) is
  'Returns the decrypted credentials JSON string for a single connection. Returns null when the row has no encrypted blob (legacy rows that have not been re-saved). Throws on key mismatch or corrupt blob so the API layer can surface a clear "re-save the Eventbrite connection" error instead of silently using an empty token.';

-- Public-side execute grants — Supabase enforces the function-level
-- check on top of RLS. The default permissions for newly-created
-- functions deny `authenticated`, so without these grants the API
-- routes would 42501 on first use.
grant execute on function set_ticketing_credentials(uuid, text, text) to authenticated;
grant execute on function get_ticketing_credentials(uuid, text)        to authenticated;

notify pgrst, 'reload schema';
