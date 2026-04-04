-- ─────────────────────────────────────────────────────────────────────────────
-- Campaign Drafts
-- Stores full wizard state as JSON. One row per campaign draft per user.
-- Status field is top-level for fast filtering in the library view.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists campaign_drafts (
  id             uuid        primary key,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  name           text,
  objective      text,
  status         text        not null default 'draft',
  ad_account_id  text,
  draft_json     jsonb       not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table campaign_drafts enable row level security;

create policy "Users can manage their own drafts"
  on campaign_drafts
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger campaign_drafts_updated_at
  before update on campaign_drafts
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Campaign Templates
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists campaign_templates (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  description   text        not null default '',
  tags          text[]      not null default '{}',
  snapshot_json jsonb       not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table campaign_templates enable row level security;

create policy "Users can manage their own templates"
  on campaign_templates
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger campaign_templates_updated_at
  before update on campaign_templates
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Facebook provider token (per user, for Meta Graph with user's Facebook session)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists user_facebook_tokens (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  provider_token  text not null,
  updated_at      timestamptz not null default now()
);

alter table user_facebook_tokens enable row level security;

create policy "Users read own facebook token"
  on user_facebook_tokens
  for select
  using (auth.uid() = user_id);

create policy "Users upsert own facebook token"
  on user_facebook_tokens
  for insert
  with check (auth.uid() = user_id);

create policy "Users update own facebook token"
  on user_facebook_tokens
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own facebook token"
  on user_facebook_tokens
  for delete
  using (auth.uid() = user_id);

create trigger user_facebook_tokens_updated_at
  before update on user_facebook_tokens
  for each row execute procedure update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────────────
-- Migration helper: add columns to existing campaign_drafts if upgrading
-- Run these if the table already exists without the new columns.
-- ─────────────────────────────────────────────────────────────────────────────
-- alter table campaign_drafts add column if not exists status text not null default 'draft';
-- alter table campaign_drafts add column if not exists ad_account_id text;
