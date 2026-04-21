-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 030 — D2C comms scaffolding.
--
-- Lands the schema for the D2C send pipeline (email, SMS, WhatsApp). Mirrors
-- the shape of migration 029 (ticketing) so the dashboard can use the same
-- mental model: per-client connections, per-event scheduled work,
-- credential blob in jsonb.
--
-- v1 SAFETY: every provider in `lib/d2c/*/provider.ts` short-circuits to a
-- dry-run logger until `FEATURE_D2C_LIVE=true`. The scheduled_sends row's
-- `status` column has a `'sent'` value but the API + UI guard against
-- writing it while the flag is off.
--
-- Three tables:
--
--   d2c_connections        — one row per (client, provider). Same idea as
--                            client_ticketing_connections: opaque credential
--                            blob, external account id, status, last_error.
--                            Provider whitelist: mailchimp / klaviyo /
--                            bird / firetext.
--
--   d2c_templates          — per-client message templates. `body_markdown`
--                            holds the source; `variables_jsonb` records
--                            the {{var}} keys callers must supply at send
--                            time. Channel: email / sms / whatsapp.
--
--   d2c_scheduled_sends    — per-event scheduled or sent message rows.
--                            Result goes in `result_jsonb` (provider response
--                            for sent rows; per-recipient errors for failed).
--                            Pre-flag: `status` is always 'scheduled' or
--                            'cancelled'; the dry-run path returns
--                            `{dryRun: true}` and we keep the row as
--                            'scheduled' so it's obvious nothing went out.
--
-- After applying:
--   npx supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt \
--     > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

-- ── d2c_connections ──────────────────────────────────────────────────────

create table if not exists d2c_connections (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users (id) on delete cascade,
  client_id            uuid        not null references clients (id)    on delete cascade,
  provider             text        not null
    check (provider in ('mailchimp', 'klaviyo', 'bird', 'firetext')),
  credentials          jsonb       not null default '{}'::jsonb,
  external_account_id  text,
  status               text        not null default 'active'
    check (status in ('active', 'paused', 'error')),
  last_synced_at       timestamptz,
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, client_id, provider)
);

comment on table  d2c_connections is
  'One row per (client, D2C provider). Same shape as client_ticketing_connections — see migration 029. Provider whitelist limited to the four channels Matas uses today.';
comment on column d2c_connections.credentials is
  'Provider-specific auth blob. Mailchimp v1 shape: {api_key, server_prefix}. Klaviyo: {api_key}. Bird: {api_key, channel_id}. Firetext: {api_key, sender}. All TBD until live integration lands.';

create index if not exists d2c_connections_user_client_idx
  on d2c_connections (user_id, client_id);
create index if not exists d2c_connections_status_idx
  on d2c_connections (status)
  where status = 'active';

-- ── d2c_templates ────────────────────────────────────────────────────────

create table if not exists d2c_templates (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users (id) on delete cascade,
  client_id         uuid        references clients (id) on delete cascade,
  name              text        not null,
  channel           text        not null
    check (channel in ('email', 'sms', 'whatsapp')),
  subject           text,
  body_markdown     text        not null default '',
  variables_jsonb   jsonb       not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table  d2c_templates is
  'Per-user message templates, optionally scoped to a client. Email templates use the subject column; SMS / WhatsApp ignore it. variables_jsonb stores the {{var}} keys the template references so the send UI can prompt for them.';

create index if not exists d2c_templates_user_client_idx
  on d2c_templates (user_id, client_id);
create index if not exists d2c_templates_channel_idx
  on d2c_templates (user_id, channel);

-- ── d2c_scheduled_sends ──────────────────────────────────────────────────

create table if not exists d2c_scheduled_sends (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  event_id        uuid        not null references events (id)     on delete cascade,
  template_id     uuid        not null references d2c_templates (id) on delete restrict,
  connection_id   uuid        not null references d2c_connections (id) on delete restrict,
  channel         text        not null
    check (channel in ('email', 'sms', 'whatsapp')),
  audience        jsonb       not null default '{}'::jsonb,
  variables       jsonb       not null default '{}'::jsonb,
  scheduled_for   timestamptz not null,
  status          text        not null default 'scheduled'
    check (status in ('scheduled', 'sent', 'failed', 'cancelled')),
  result_jsonb    jsonb,
  dry_run         boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table  d2c_scheduled_sends is
  'Per-event D2C send rows. status=sent is only writable when FEATURE_D2C_LIVE is true; otherwise the dry-run path keeps status=scheduled and dry_run=true. result_jsonb is the provider response (success rows) or per-recipient error map (failed rows).';
comment on column d2c_scheduled_sends.audience is
  'Audience descriptor — provider-specific. Mailchimp: {list_id, segment_id?}. Klaviyo: {list_id}. SMS: {phone_numbers: [...]} or {segment_id}.';
comment on column d2c_scheduled_sends.dry_run is
  'true when written by the dry-run path (FEATURE_D2C_LIVE=false). The dashboard surfaces a [DRY RUN] badge when set.';

create index if not exists d2c_scheduled_sends_event_idx
  on d2c_scheduled_sends (event_id, scheduled_for desc);
create index if not exists d2c_scheduled_sends_status_idx
  on d2c_scheduled_sends (status, scheduled_for asc)
  where status = 'scheduled';

-- ── RLS ──────────────────────────────────────────────────────────────────

alter table d2c_connections      enable row level security;
alter table d2c_templates        enable row level security;
alter table d2c_scheduled_sends  enable row level security;

drop policy if exists d2c_conn_select on d2c_connections;
create policy d2c_conn_select on d2c_connections
  for select using (auth.uid() = user_id);
drop policy if exists d2c_conn_insert on d2c_connections;
create policy d2c_conn_insert on d2c_connections
  for insert with check (auth.uid() = user_id);
drop policy if exists d2c_conn_update on d2c_connections;
create policy d2c_conn_update on d2c_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists d2c_conn_delete on d2c_connections;
create policy d2c_conn_delete on d2c_connections
  for delete using (auth.uid() = user_id);

drop policy if exists d2c_tpl_select on d2c_templates;
create policy d2c_tpl_select on d2c_templates
  for select using (auth.uid() = user_id);
drop policy if exists d2c_tpl_insert on d2c_templates;
create policy d2c_tpl_insert on d2c_templates
  for insert with check (auth.uid() = user_id);
drop policy if exists d2c_tpl_update on d2c_templates;
create policy d2c_tpl_update on d2c_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists d2c_tpl_delete on d2c_templates;
create policy d2c_tpl_delete on d2c_templates
  for delete using (auth.uid() = user_id);

drop policy if exists d2c_send_select on d2c_scheduled_sends;
create policy d2c_send_select on d2c_scheduled_sends
  for select using (auth.uid() = user_id);
drop policy if exists d2c_send_insert on d2c_scheduled_sends;
create policy d2c_send_insert on d2c_scheduled_sends
  for insert with check (auth.uid() = user_id);
drop policy if exists d2c_send_update on d2c_scheduled_sends;
create policy d2c_send_update on d2c_scheduled_sends
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists d2c_send_delete on d2c_scheduled_sends;
create policy d2c_send_delete on d2c_scheduled_sends
  for delete using (auth.uid() = user_id);

-- ── updated_at touch triggers ───────────────────────────────────────────

create or replace function set_d2c_connections_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists d2c_conn_set_updated_at on d2c_connections;
create trigger d2c_conn_set_updated_at
  before update on d2c_connections
  for each row execute function set_d2c_connections_updated_at();

create or replace function set_d2c_templates_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists d2c_tpl_set_updated_at on d2c_templates;
create trigger d2c_tpl_set_updated_at
  before update on d2c_templates
  for each row execute function set_d2c_templates_updated_at();

create or replace function set_d2c_scheduled_sends_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists d2c_send_set_updated_at on d2c_scheduled_sends;
create trigger d2c_send_set_updated_at
  before update on d2c_scheduled_sends
  for each row execute function set_d2c_scheduled_sends_updated_at();

notify pgrst, 'reload schema';
