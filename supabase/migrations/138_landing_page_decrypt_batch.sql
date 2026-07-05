-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 138 — landing_page_decrypt_batch (OP909 Phase 5, fan data table)
--
-- The admin fan table shows a page of 50 decrypted emails/phones. Calling
-- landing_page_decrypt (migration 134) per value = up to 100 RPC round
-- trips per page view. This wrapper decrypts an ARRAY of blobs in one
-- call, preserving order and null elements (repeat/attribution-only rows
-- carry no PII).
--
-- Same posture as 134: SECURITY DEFINER, schema-agnostic pgcrypto via
-- search_path = public, extensions (per project_supabase_pgcrypto_
-- extensions_schema — pgcrypto has lived in BOTH schemas on prod),
-- key passed per call, service_role execute ONLY.
--
-- Rollback:
--   drop function if exists landing_page_decrypt_batch(bytea[], text);
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function landing_page_decrypt_batch(p_blobs bytea[], p_key text)
returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_out text[] := '{}';
  v_blob bytea;
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'LANDING_PAGES_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_blobs is null then
    return v_out;
  end if;
  foreach v_blob in array p_blobs loop
    if v_blob is null then
      v_out := array_append(v_out, null);
    else
      -- Unqualified on purpose — search_path covers pgcrypto in either
      -- public or extensions (do not schema-qualify; see migration 134).
      v_out := array_append(v_out, pgp_sym_decrypt(v_blob, p_key));
    end if;
  end loop;
  return v_out;
end;
$$;

comment on function landing_page_decrypt_batch(bytea[], text) is
  'Array form of landing_page_decrypt for the admin fan table (one RPC per page instead of one per value). Order-preserving, null-preserving. service_role execute only. Migration 138.';

revoke all on function landing_page_decrypt_batch(bytea[], text) from public;
revoke all on function landing_page_decrypt_batch(bytea[], text) from anon, authenticated;
grant execute on function landing_page_decrypt_batch(bytea[], text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — round-trip through the 134 encrypt fn, including a null
-- element, inside the migration transaction (loud rollback on any miss).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_key text := 'migration-138-probe-key';
  v_blobs bytea[];
  v_out text[];
begin
  v_blobs := array[
    landing_page_encrypt('alpha@example.com', v_key),
    null,
    landing_page_encrypt('+447700900123', v_key)
  ];
  v_out := landing_page_decrypt_batch(v_blobs, v_key);
  if v_out is distinct from array['alpha@example.com', null, '+447700900123']::text[] then
    raise exception 'migration 138 verification: batch round-trip mismatch (got %)', v_out;
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges
    where routine_name = 'landing_page_decrypt_batch'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'migration 138 verification: decrypt_batch must not be executable by anon/authenticated';
  end if;

  raise notice 'migration 138 verification passed';
end $$;
