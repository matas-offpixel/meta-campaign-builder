-- Migration 044 — Off-Meta additional spend + per-day Meta registrations for Daily Tracker
--
-- additional_spend_entries: manual PR / influencer / print / etc. surfaced in Performance
-- Summary + Daily Tracker; RLS per owner.
--
-- event_daily_rollups.meta_regs: per-day sum of Meta complete_registration actions
-- (rollup-sync populates from Graph insights time_increment=1).

-- ── additional_spend_entries ───────────────────────────────────────────────

create type additional_spend_category as enum (
  'PR',
  'INFLUENCER',
  'PRINT',
  'RADIO',
  'OTHER'
);

create table if not exists additional_spend_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  event_id    uuid not null references events (id) on delete cascade,
  date        date not null,
  amount      numeric(12, 2) not null check (amount >= 0),
  category    additional_spend_category not null default 'OTHER',
  label       text not null default '',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists additional_spend_entries_event_date_idx
  on additional_spend_entries (event_id, date desc);

alter table additional_spend_entries enable row level security;

drop policy if exists ase_owner_select on additional_spend_entries;
create policy ase_owner_select on additional_spend_entries
  for select using (auth.uid() = user_id);

drop policy if exists ase_owner_insert on additional_spend_entries;
create policy ase_owner_insert on additional_spend_entries
  for insert with check (auth.uid() = user_id);

drop policy if exists ase_owner_update on additional_spend_entries;
create policy ase_owner_update on additional_spend_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ase_owner_delete on additional_spend_entries;
create policy ase_owner_delete on additional_spend_entries
  for delete using (auth.uid() = user_id);

create or replace function set_additional_spend_entries_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_additional_spend_entries_updated_at
  on additional_spend_entries;
create trigger trg_additional_spend_entries_updated_at
  before update on additional_spend_entries
  for each row execute function set_additional_spend_entries_updated_at();

-- ── event_daily_rollups.meta_regs ──────────────────────────────────────────

alter table event_daily_rollups
  add column if not exists meta_regs integer;

notify pgrst, 'reload schema';
