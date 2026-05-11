-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 090 — Per-client Meta System User token (Phase 1 canary).
--
-- Spec lives in `docs/META_TOKEN_ARCHITECTURE_2026-05-11.md` §5. The
-- design doc references this as "migration 075" because that was the
-- next slot when the doc was written, but slot 075 has already shipped
-- (`075_additional_ticket_entries_running_total_key.sql`) so this lands
-- as 090 — the next available number on main.
--
-- Until now, every Meta API call resolves through Matas's personal
-- OAuth token (see `lib/meta/server-token.ts` →
-- `user_facebook_tokens.provider_token`). All cron + UI + write traffic
-- shares the same per-user `#17` rolling rate-limit bucket, so
-- WC26-scale audience builds collide with the parallel reporting cron.
--
-- This migration introduces a per-client *System User* token column on
-- `clients`. System User tokens are non-expiring and accounted under
-- Meta's *Business Use Case* (BUC) bucket, which is per-ad-account, so
-- a 4thefans audience build no longer steals quota from a Junction 2
-- rollup-sync. The Phase 1 canary routes ONLY two non-interactive
-- paths to the new token (rollup-sync Meta leg + audience bulk write).
-- The personal-token resolver remains the fallback for every client
-- without a System User provisioned and for every code path not yet
-- migrated (see Phase 2 / Phase 3 in the design doc).
--
-- Schema:
--   meta_system_user_token_encrypted   bytea         — pgp_sym_encrypt(token, key)
--   meta_system_user_token_set_at      timestamptz   — last save (UI display)
--   meta_system_user_token_last_used_at timestamptz  — last successful resolve
--                                                     (best-effort write from
--                                                      the resolver)
--
-- Encryption key:
--   `META_SYSTEM_TOKEN_KEY` env var (mirrors mig 038's
--   EVENTBRITE_TOKEN_KEY pattern). Anything random + ≥32 chars is
--   fine — pgcrypto stretches it internally. Pass it as a parameter to
--   the RPC on every call; never persist it. Rotation = re-save every
--   System User token under the new key.
--
-- Function security posture (different from mig 038's INVOKER pattern
-- because this token is service-role-only — no UI render path ever
-- needs to decrypt it directly; only the resolver does):
--   - SECURITY DEFINER: function executes as the table owner regardless
--     of caller, so we don't depend on RLS being permissive for the
--     service_role key.
--   - REVOKE EXECUTE FROM anon, authenticated, public.
--   - GRANT EXECUTE TO service_role ONLY. Only the
--     `lib/meta/system-user-token.ts` resolver (called via the
--     service-role Supabase client) and the
--     `/api/clients/[id]/meta-system-user-token` admin route may invoke
--     these RPCs.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

alter table clients
  add column if not exists meta_system_user_token_encrypted    bytea,
  add column if not exists meta_system_user_token_set_at       timestamptz,
  add column if not exists meta_system_user_token_last_used_at timestamptz;

comment on column clients.meta_system_user_token_encrypted is
  'pgp_sym_encrypt(plaintext_token, META_SYSTEM_TOKEN_KEY) — never decrypted server-side except via get_meta_system_user_token() with the env-loaded key. NULL means the client has not provisioned a Meta Business Manager System User yet; the resolver falls back to the personal OAuth token.';
comment on column clients.meta_system_user_token_set_at is
  'When the System User token was last saved via the Account Setup UI. Surfaced verbatim next to the masked-token preview so operators can spot stale tokens.';
comment on column clients.meta_system_user_token_last_used_at is
  'Best-effort write from `resolveSystemUserToken` after a successful decrypt. Lets us spot clients whose token has gone unused (rotation candidates) without parsing logs.';

-- ── set_meta_system_user_token ───────────────────────────────────────────────

create or replace function set_meta_system_user_token(
  p_client_id uuid,
  p_token     text,
  p_key       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'META_SYSTEM_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_token is null or length(p_token) = 0 then
    raise exception 'plaintext token is required';
  end if;

  update clients
     set meta_system_user_token_encrypted = pgp_sym_encrypt(p_token, p_key),
         meta_system_user_token_set_at    = now(),
         updated_at                       = now()
   where id = p_client_id;

  if not found then
    raise exception 'client % not found', p_client_id;
  end if;
end;
$$;

comment on function set_meta_system_user_token(uuid, text, text) is
  'Encrypts a Meta Business Manager System User token and stores it on clients.meta_system_user_token_encrypted. Stamps meta_system_user_token_set_at = now(). SECURITY DEFINER + REVOKE-from-public + GRANT-to-service_role ensure only the admin API route can write this. The key parameter is never persisted.';

-- ── get_meta_system_user_token ───────────────────────────────────────────────

create or replace function get_meta_system_user_token(
  p_client_id uuid,
  p_key       text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blob bytea;
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'META_SYSTEM_TOKEN_KEY must be set and at least 8 characters';
  end if;

  select meta_system_user_token_encrypted
    into v_blob
    from clients
   where id = p_client_id;

  -- NULL = client row is missing or has no token; resolver returns
  -- null and falls back to the personal-OAuth path. Caller MUST treat
  -- "missing row" and "missing token" identically.
  if v_blob is null then
    return null;
  end if;

  return pgp_sym_decrypt(v_blob, p_key)::text;
end;
$$;

comment on function get_meta_system_user_token(uuid, text) is
  'Returns the decrypted Meta System User token for a client, or null when the column is unset. Throws on key mismatch or corrupt blob so the resolver can log the failure and fall back to the personal-OAuth path.';

-- ── clear_meta_system_user_token ─────────────────────────────────────────────
--
-- Separate clear RPC so the DELETE handler doesn't need to round-trip a
-- raw NULL via the encryption RPC. Clears all three token columns in one
-- statement so a "Remove" click leaves no half-state behind.

create or replace function clear_meta_system_user_token(
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update clients
     set meta_system_user_token_encrypted    = null,
         meta_system_user_token_set_at       = null,
         meta_system_user_token_last_used_at = null,
         updated_at                          = now()
   where id = p_client_id;

  if not found then
    raise exception 'client % not found', p_client_id;
  end if;
end;
$$;

comment on function clear_meta_system_user_token(uuid) is
  'Clears the encrypted Meta System User token plus its set/last-used timestamps. Used by the DELETE handler on /api/clients/[id]/meta-system-user-token.';

-- Lock down execute privileges. Default Supabase grants execute on new
-- functions to PUBLIC, so the explicit REVOKE is load-bearing — without
-- it, any authenticated user could read every client's System User
-- token.
revoke execute on function set_meta_system_user_token(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function get_meta_system_user_token(uuid, text)
  from public, anon, authenticated;
revoke execute on function clear_meta_system_user_token(uuid)
  from public, anon, authenticated;

grant execute on function set_meta_system_user_token(uuid, text, text)
  to service_role;
grant execute on function get_meta_system_user_token(uuid, text)
  to service_role;
grant execute on function clear_meta_system_user_token(uuid)
  to service_role;

notify pgrst, 'reload schema';
