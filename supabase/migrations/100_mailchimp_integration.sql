-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 100 — Mailchimp Marketing API integration.
--
-- Adds:
--   mailchimp_accounts         — one row per connected Mailchimp account (API
--                                key stored encrypted via pgp_sym_encrypt,
--                                mirroring the tiktok_accounts / 054 pattern).
--   clients.mailchimp_account_id  — FK to default Mailchimp account for client.
--   clients.mailchimp_audience_id — default list/audience id for the client.
--   events.mailchimp_audience_id  — optional per-event override.
--   mailchimp_audience_snapshots  — daily audience-size snapshot rows written
--                                   by the sync-mailchimp-audiences cron.
--
-- RPCs:
--   set_mailchimp_credentials / get_mailchimp_credentials
--   (mirrors set_tiktok_credentials / get_tiktok_credentials from 054)
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── mailchimp_accounts ───────────────────────────────────────────────────────

create table if not exists mailchimp_accounts (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                uuid        not null references auth.users (id) on delete cascade,
  account_name           text,
  mailchimp_dc           text,
  mailchimp_login_id     text,
  credentials_encrypted  bytea,
  credentials_format     text        not null default 'v1',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists mailchimp_accounts_user_id_idx
  on mailchimp_accounts (user_id);

comment on table  mailchimp_accounts is
  'Connected Mailchimp accounts. credentials_encrypted holds pgp_sym_encrypt(json, MAILCHIMP_TOKEN_KEY) — never returned to clients.';
comment on column mailchimp_accounts.mailchimp_dc is
  'Data-center suffix from the API key, e.g. "us21". Drives the base URL.';
comment on column mailchimp_accounts.credentials_format is
  'Schema version of the encrypted payload. v1 = { apiKey, dc, loginId, accountName }.';

alter table mailchimp_accounts enable row level security;

drop policy if exists mailchimp_accounts_owner_select on mailchimp_accounts;
create policy mailchimp_accounts_owner_select on mailchimp_accounts
  for select using (auth.uid() = user_id);

drop policy if exists mailchimp_accounts_owner_insert on mailchimp_accounts;
create policy mailchimp_accounts_owner_insert on mailchimp_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists mailchimp_accounts_owner_update on mailchimp_accounts;
create policy mailchimp_accounts_owner_update on mailchimp_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists mailchimp_accounts_owner_delete on mailchimp_accounts;
create policy mailchimp_accounts_owner_delete on mailchimp_accounts
  for delete using (auth.uid() = user_id);

create or replace function set_mailchimp_accounts_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mailchimp_accounts_set_updated_at on mailchimp_accounts;
create trigger mailchimp_accounts_set_updated_at
  before update on mailchimp_accounts
  for each row execute function set_mailchimp_accounts_updated_at();

-- ── credential RPCs ──────────────────────────────────────────────────────────

create or replace function set_mailchimp_credentials(
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
    raise exception 'MAILCHIMP_TOKEN_KEY must be set and at least 8 characters';
  end if;
  if p_plaintext is null or length(p_plaintext) = 0 then
    raise exception 'plaintext credentials are required';
  end if;

  update mailchimp_accounts
     set credentials_encrypted = pgp_sym_encrypt(p_plaintext, p_key),
         credentials_format    = 'v1',
         updated_at            = now()
   where id = p_account_id;

  if not found then
    raise exception 'Mailchimp account % not found or not owned by current user', p_account_id;
  end if;
end;
$$;

comment on function set_mailchimp_credentials(uuid, text, text) is
  'Encrypts plaintext Mailchimp credentials JSON and stores it in mailchimp_accounts.credentials_encrypted. SECURITY INVOKER + RLS ensure callers can only update rows they own.';

create or replace function get_mailchimp_credentials(
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
    raise exception 'MAILCHIMP_TOKEN_KEY must be set and at least 8 characters';
  end if;

  select credentials_encrypted
    into v_blob
    from mailchimp_accounts
   where id = p_account_id;

  if v_blob is null then
    return null;
  end if;

  return pgp_sym_decrypt(v_blob, p_key)::text;
end;
$$;

comment on function get_mailchimp_credentials(uuid, text) is
  'Returns decrypted Mailchimp credentials JSON. Returns null when no blob exists. Throws on key mismatch so callers can surface a reconnect prompt.';

grant execute on function set_mailchimp_credentials(uuid, text, text) to authenticated;
grant execute on function get_mailchimp_credentials(uuid, text)       to authenticated;

-- ── clients columns ──────────────────────────────────────────────────────────

alter table clients
  add column if not exists mailchimp_account_id  uuid
    references mailchimp_accounts (id) on delete set null,
  add column if not exists mailchimp_audience_id text;

create index if not exists clients_mailchimp_account_id_idx
  on clients (mailchimp_account_id);

comment on column clients.mailchimp_account_id is
  'Default Mailchimp account for all events under this client. Events inherit unless overridden.';
comment on column clients.mailchimp_audience_id is
  'Default Mailchimp audience/list id for registration tracking. Events inherit unless overridden.';

-- ── events.mailchimp_audience_id ─────────────────────────────────────────────

alter table events
  add column if not exists mailchimp_audience_id text;

comment on column events.mailchimp_audience_id is
  'Optional per-event override for the Mailchimp audience id. Falls back to clients.mailchimp_audience_id when null.';

-- ── mailchimp_audience_snapshots ─────────────────────────────────────────────

create table if not exists mailchimp_audience_snapshots (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        references auth.users (id) on delete set null,
  event_id                uuid        references events (id) on delete cascade,
  client_id               uuid        references clients (id) on delete set null,
  mailchimp_audience_id   text        not null,
  total_contacts          integer,
  email_subscribers       integer,
  pending                 integer,
  unsubscribed            integer,
  cleaned                 integer,
  member_count_since_send integer,
  avg_open_rate           numeric(8, 4),
  avg_click_rate          numeric(8, 4),
  snapshot_at             timestamptz not null default now(),
  raw_json                jsonb
);

comment on table mailchimp_audience_snapshots is
  'Daily snapshots of Mailchimp audience stats per event. Cron writes one row per (event_id, day). email_subscribers is the primary metric for registration counting.';

-- Unique constraint: one row per (event, calendar day) so the cron can
-- ON CONFLICT DO UPDATE idempotently.
create unique index if not exists mailchimp_audience_snapshots_event_day_uq
  on mailchimp_audience_snapshots (event_id, (snapshot_at::date))
  where event_id is not null;

-- Fast lookups on the share report / cron path.
create index if not exists mailchimp_audience_snapshots_event_id_idx
  on mailchimp_audience_snapshots (event_id, snapshot_at desc);

alter table mailchimp_audience_snapshots enable row level security;

-- Authenticated users can read their own rows.
drop policy if exists mailchimp_audience_snapshots_owner_select on mailchimp_audience_snapshots;
create policy mailchimp_audience_snapshots_owner_select on mailchimp_audience_snapshots
  for select using (auth.uid() = user_id);

-- No direct insert/update from authenticated users — writes come through the
-- service-role cron only (or the manual-refresh route that calls the cron
-- helper under service role).
-- Service role bypasses RLS entirely, so no extra policy is needed.

-- ── Ironworks baseline backfill ───────────────────────────────────────────────

-- Set the Mailchimp audience on the Ironworks client row so events inherit it.
update clients
   set mailchimp_audience_id = '6b62bb8448'
 where id = 'f7ed8aef-8527-4c3e-a16a-a05fc38861f5';

-- Insert the launch-day baseline snapshot so the share report can immediately
-- compute "new registrations since baseline" once the first sync runs.
insert into mailchimp_audience_snapshots (
  user_id,
  event_id,
  client_id,
  mailchimp_audience_id,
  total_contacts,
  email_subscribers,
  snapshot_at,
  raw_json
) values (
  'b3ee4e5c-44e6-4684-acf6-efefbecd5858',
  '68535c85-0394-435f-9439-245dd2e87043',
  'f7ed8aef-8527-4c3e-a16a-a05fc38861f5',
  '6b62bb8448',
  3000,
  2996,
  '2026-06-02 00:00:00+00',
  '{"source":"manual_baseline","note":"Launch baseline from Mailchimp UI screenshot"}'::jsonb
)
on conflict (event_id, (snapshot_at::date))
  where event_id is not null
  do nothing;

notify pgrst, 'reload schema';
