-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016 — TikTok platform scaffold.
--
-- TikTok ads run separately from Meta. Two known TikTok accounts exist:
--   - "Louder" — used for Parable / Louder events
--   - "Amaad"  — used for Junction 2
--
-- Schema:
--   - tiktok_accounts          one row per linked advertiser
--                              owned by a user (RLS scoped to user_id).
--   - events.tiktok_account_id FK to tiktok_accounts so an event opts
--                              into the TikTok side of the platform mix.
--                              Nullable — unset = no TikTok activity.
--
-- access_token_encrypted is a placeholder for the eventual OAuth flow
-- (the long-lived TikTok Business token, encrypted at rest with the
-- same envelope strategy used for Meta long-lived tokens).
--
-- After applying:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists tiktok_accounts (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references auth.users (id) on delete cascade,
  account_name             text        not null,
  tiktok_advertiser_id     text,
  access_token_encrypted   text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint tiktok_accounts_user_account_unique
    unique (user_id, account_name)
);

create index if not exists tiktok_accounts_user_id_idx
  on tiktok_accounts (user_id);

comment on table  tiktok_accounts is
  'Linked TikTok Business advertiser accounts. One row per advertiser the owner has connected. access_token_encrypted is a placeholder until the OAuth flow lands.';
comment on column tiktok_accounts.account_name is
  'Friendly label shown in dashboard pickers (e.g. "Louder", "Amaad").';
comment on column tiktok_accounts.tiktok_advertiser_id is
  'Numeric advertiser id from TikTok Ads Manager. Required to make any API call — null until verified.';
comment on column tiktok_accounts.access_token_encrypted is
  'Long-lived TikTok Business access token, encrypted at rest. Null until OAuth flow is wired (see app/api/tiktok/* stubs).';

alter table tiktok_accounts enable row level security;

drop policy if exists tiktok_accounts_owner_select on tiktok_accounts;
create policy tiktok_accounts_owner_select on tiktok_accounts
  for select using (auth.uid() = user_id);

drop policy if exists tiktok_accounts_owner_insert on tiktok_accounts;
create policy tiktok_accounts_owner_insert on tiktok_accounts
  for insert with check (auth.uid() = user_id);

drop policy if exists tiktok_accounts_owner_update on tiktok_accounts;
create policy tiktok_accounts_owner_update on tiktok_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tiktok_accounts_owner_delete on tiktok_accounts;
create policy tiktok_accounts_owner_delete on tiktok_accounts
  for delete using (auth.uid() = user_id);

-- updated_at touch trigger — mirrors the pattern from migrations 005 / 010.
create or replace function set_tiktok_accounts_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tiktok_accounts_set_updated_at on tiktok_accounts;
create trigger tiktok_accounts_set_updated_at
  before update on tiktok_accounts
  for each row execute function set_tiktok_accounts_updated_at();

-- ── Per-event link ─────────────────────────────────────────────────────────

alter table events
  add column if not exists tiktok_account_id uuid
    references tiktok_accounts (id) on delete set null;

create index if not exists events_tiktok_account_id_idx
  on events (tiktok_account_id);

comment on column events.tiktok_account_id is
  'Optional FK to the TikTok account driving paid spend for this event. Null = no TikTok activity. Inherits from clients.tiktok_account_id when not set explicitly (see migration 018).';

notify pgrst, 'reload schema';
