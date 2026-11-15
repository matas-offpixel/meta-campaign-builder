-- Migration 246 — d2c_broadcast_stats (dashboard v2 phase 2, HE3)
--
-- Direct-to-fan send stats, one row per Bird campaign or Mailchimp
-- campaign: sent, delivered, read (Bird's read receipts), clicked, and
-- for email the raw and Mailchimp's bot-filtered unique opens. Written
-- by the nightly ingest (lib/d2c/stats-ingest, behind
-- ENABLE_D2C_STATS_INGEST) and scripts/d2c-stats-backfill.mts --apply.
-- Read-only against Bird and Mailchimp; nothing here is ever sent back.
--
-- Plus clients.whatsapp_message_rate: the client's Bird per-message
-- rate, which Matas sets. WhatsApp cost = delivered × this rate. Null
-- (the default) means cost shows nothing.
--
-- Rows carry campaign names and audience names, no person-level data.
-- No authenticated read: the dashboard reads through the service role.
--
-- Apply by hand from main. Idempotent.

-- ─── Per-client WhatsApp rate ────────────────────────────────────────────

alter table clients
  add column if not exists whatsapp_message_rate numeric(10, 5);

alter table clients
  add column if not exists whatsapp_message_rate_currency text;

alter table clients
  drop constraint if exists clients_whatsapp_message_rate_nonneg;
alter table clients
  add constraint clients_whatsapp_message_rate_nonneg check (
    whatsapp_message_rate is null or whatsapp_message_rate >= 0
  );

alter table clients
  drop constraint if exists clients_whatsapp_message_rate_currency_check;
alter table clients
  add constraint clients_whatsapp_message_rate_currency_check check (
    whatsapp_message_rate_currency is null
    or whatsapp_message_rate_currency in ('GBP', 'EUR', 'USD')
  );

comment on column clients.whatsapp_message_rate is
  'Bird per-message rate for this client''s WhatsApp sends. Matas sets it; no invoice entry. WhatsApp cost = delivered × rate. Null = cost not shown.';
comment on column clients.whatsapp_message_rate_currency is
  'Currency of whatsapp_message_rate. Null reads as GBP.';

-- ─── d2c_broadcast_stats ─────────────────────────────────────────────────

create table if not exists d2c_broadcast_stats (
  id                     uuid primary key default gen_random_uuid(),
  provider               text not null check (provider in ('bird', 'mailchimp')),
  account_id             text not null,
  external_id            text not null,
  channel                text not null check (channel in ('whatsapp', 'sms', 'email')),
  client_id              uuid references clients(id) on delete cascade,
  event_id               uuid references events(id) on delete set null,
  attribution            text not null check (attribution in ('show', 'client', 'unattributed')),
  audience_kind          text not null default 'marketing' check (audience_kind in ('marketing', 'ticket_holder')),
  name                   text,
  sent_at                timestamptz,
  list_id                text,
  channel_ids            text[],
  audience               jsonb,
  sent                   integer,
  delivered              integer,
  read                   integer,
  clicked                integer,
  opens_unique_raw       integer,
  opens_unique_filtered  integer,
  open_rate_filtered     numeric(8, 6),
  bounces                integer,
  unsubscribes           integer,
  raw                    jsonb,
  first_seen_at          timestamptz not null default now(),
  fetched_at             timestamptz not null default now(),
  constraint d2c_broadcast_stats_provider_account_external_key
    unique (provider, account_id, external_id),
  constraint d2c_broadcast_stats_show_has_event check (
    attribution <> 'show' or event_id is not null
  )
);

comment on table d2c_broadcast_stats is
  'HE3: one row per Bird or Mailchimp campaign. Show rows carry event_id; a whole-list send sits under the client only. Service role only.';
comment on column d2c_broadcast_stats.account_id is
  'Bird workspace id, or the Mailchimp account_id from GET /3.0/.';
comment on column d2c_broadcast_stats.external_id is
  'Bird campaign id, or Mailchimp campaign id.';
comment on column d2c_broadcast_stats.attribution is
  'show: every audience the send targets is one show''s tag or CQ-{slug} list. client: a whole-list or mixed send. unattributed: no show matched and the account is shared by more than one client.';
comment on column d2c_broadcast_stats.audience_kind is
  'ticket_holder when a targeted list or segment is named as ticket holders / buyers / purchasers; else marketing.';
comment on column d2c_broadcast_stats.audience is
  'The lists / segments the send targeted, with ids and names, and the match mode. Names only, never members.';
comment on column d2c_broadcast_stats.read is
  'Bird readOrOpened: WhatsApp read receipts (only for recipients with read receipts on). Null for email.';
comment on column d2c_broadcast_stats.clicked is
  'Bird clicked (short-link clicks), or Mailchimp unique_subscriber_clicks.';
comment on column d2c_broadcast_stats.opens_unique_raw is
  'Mailchimp unique_opens, Apple Mail Privacy and scanners included. Never shown as the open rate.';
comment on column d2c_broadcast_stats.opens_unique_filtered is
  'Mailchimp proxy_excluded_unique_opens (bot-filtered) when the report gives it; else null and the reader estimates.';
comment on column d2c_broadcast_stats.open_rate_filtered is
  'Mailchimp proxy_excluded_open_rate (0..1) when the report gives it.';
comment on column d2c_broadcast_stats.raw is
  'The provider summary the counts came from (Bird reporting summary, trimmed Mailchimp report).';

create index if not exists d2c_broadcast_stats_client_idx
  on d2c_broadcast_stats (client_id, sent_at);
create index if not exists d2c_broadcast_stats_event_idx
  on d2c_broadcast_stats (event_id, sent_at)
  where event_id is not null;

alter table d2c_broadcast_stats enable row level security;

do $$
begin
  -- A policy of false, not the absence of a policy: a later grant of
  -- authenticated SELECT still matches nothing.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'd2c_broadcast_stats'
      and policyname = 'd2c_broadcast_stats no authenticated read'
  ) then
    execute
      'create policy "d2c_broadcast_stats no authenticated read" '
      'on d2c_broadcast_stats for select to authenticated using (false)';
  end if;
end $$;

notify pgrst, 'reload schema';
