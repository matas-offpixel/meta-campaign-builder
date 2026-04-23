-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 042 — D2C connection credential encryption + per-client live gates
-- + scheduled-send approval columns.
--
-- Follow-up: migration 043 should drop the legacy `credentials` jsonb column on
-- `d2c_connections` after every environment has re-saved connections and
-- confirmed `credentials_encrypted` reads succeed.
--
-- Symmetric key: D2C_TOKEN_KEY (app env, passed into RPCs — never stored).
-- Optional one-off backfill: before `supabase db push`, run in the same session:
--   SET LOCAL d2c.backfill_token_key = '<same value as D2C_TOKEN_KEY>';
-- then apply; otherwise legacy plaintext rows remain readable via the jsonb
-- column until re-saved through the dashboard.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

alter table d2c_connections
  add column if not exists credentials_encrypted bytea,
  add column if not exists live_enabled boolean not null default false,
  add column if not exists approved_by_matas boolean not null default false;

comment on column d2c_connections.credentials_encrypted is
  'pgp_sym_encrypt(credentials_json::text, D2C_TOKEN_KEY). Plaintext `credentials` jsonb is wiped on write via set_d2c_credentials.';
comment on column d2c_connections.live_enabled is
  'Per-client operator toggle — must be true alongside approved_by_matas and FEATURE_D2C_LIVE before Mailchimp sends leave dry-run.';
comment on column d2c_connections.approved_by_matas is
  'Paranoia flag — both live_enabled and this must be true before cron may perform live Mailchimp sends.';

alter table d2c_scheduled_sends
  add column if not exists approval_status text not null default 'pending_approval'
    check (approval_status in ('pending_approval', 'approved', 'rejected')),
  add column if not exists approved_by uuid references auth.users (id),
  add column if not exists approved_at timestamptz;

comment on column d2c_scheduled_sends.approval_status is
  'Human approval gate before cron — only approved rows are eligible for live send.';
comment on column d2c_scheduled_sends.approved_by is
  'Operator who approved (see lib/auth/operator-allowlist.ts on the app side).';

-- ── set_d2c_credentials ─────────────────────────────────────────────────────

create or replace function set_d2c_credentials(
  p_id uuid,
  p_credentials jsonb,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or length(p_key) < 8 then
    raise exception 'D2C_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_credentials is null or p_credentials = 'null'::jsonb
     or p_credentials = '{}'::jsonb then
    raise exception 'credentials are required';
  end if;

  update d2c_connections
     set credentials_encrypted = pgp_sym_encrypt(p_credentials::text, p_key),
         credentials           = '{}'::jsonb,
         updated_at            = now()
   where id = p_id
     and user_id = auth.uid();

  if not found then
    raise exception 'connection % not found or not owned by current user', p_id;
  end if;
end;
$$;

comment on function set_d2c_credentials(uuid, jsonb, text) is
  'Encrypts D2C credentials JSON into credentials_encrypted and wipes legacy credentials jsonb. SECURITY DEFINER; ownership enforced via user_id = auth.uid().';

-- ── get_d2c_credentials ───────────────────────────────────────────────────

create or replace function get_d2c_credentials(
  p_id uuid,
  p_key text
)
returns jsonb
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
    raise exception 'D2C_TOKEN_KEY must be set and at least 8 characters';
  end if;

  select credentials_encrypted, user_id
    into v_blob, v_owner
    from d2c_connections
   where id = p_id;

  if v_owner is null then
    return null;
  end if;

  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    v_allowed := true;
  elsif auth.uid() is not null and auth.uid() = v_owner then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'not found' using errcode = '42501';
  end if;

  if v_blob is null then
    return null;
  end if;

  return (pgp_sym_decrypt(v_blob, p_key))::text::jsonb;
end;
$$;

comment on function get_d2c_credentials(uuid, text) is
  'Decrypts credentials_encrypted for a connection. Allows service_role (cron) or the owning authenticated user.';

revoke all on function set_d2c_credentials(uuid, jsonb, text) from public;
revoke all on function get_d2c_credentials(uuid, text) from public;

grant execute on function set_d2c_credentials(uuid, jsonb, text) to authenticated;
grant execute on function get_d2c_credentials(uuid, text) to authenticated;
grant execute on function get_d2c_credentials(uuid, text) to service_role;

-- ── Optional legacy backfill (same encryption as set_d2c_credentials) ─────

do $$
declare
  r record;
  k text := current_setting('d2c.backfill_token_key', true);
begin
  if k is null or length(trim(k)) < 8 then
    raise notice '042_d2c: optional backfill skipped — set session d2c.backfill_token_key to encrypt legacy credentials in this migration run';
  else
    for r in
      select id, credentials
        from d2c_connections
       where credentials_encrypted is null
         and credentials is not null
         and credentials <> '{}'::jsonb
         and credentials::text not in ('null', '{}')
    loop
      update d2c_connections
         set credentials_encrypted = pgp_sym_encrypt(r.credentials::text, k),
             credentials           = '{}'::jsonb,
             updated_at            = now()
       where id = r.id;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
