-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026 — TikTok manual reports.
--
-- Until the TikTok Business OAuth flow is wired (see migration 016), reporting
-- is sourced from manually exported XLSX/CSV files dropped into the dashboard
-- by the team. Each import becomes one row in `tiktok_manual_reports`, holding
-- the parsed snapshot blob plus enough metadata to find / dedupe / filter it.
--
-- snapshot_json conforms to TikTokManualReportSnapshot (lib/types/tiktok.ts):
--   { v: 1, fetchedAt, dateRange, campaign, geo[], demographics[],
--     interests[], searchTerms[] }
--
-- The `source` discriminator lets us swap manual XLSX rows for live API rows
-- in place once OAuth lands without changing the read surface.
--
-- After applying:
--   npx supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt \
--     > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists tiktok_manual_reports (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,
  client_id           uuid        references clients (id)         on delete cascade,
  event_id            uuid        references events (id)          on delete cascade,
  tiktok_account_id   uuid        references tiktok_accounts (id) on delete set null,
  campaign_name       text        not null,
  date_range_start    date        not null,
  date_range_end      date        not null,
  source              text        not null default 'manual_xlsx'
    check (source in ('manual_xlsx', 'manual_csv', 'api')),
  imported_at         timestamptz not null default now(),
  snapshot_json       jsonb       not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table  tiktok_manual_reports is
  'One row per TikTok report import. Until OAuth is wired, the team uploads XLSX/CSV exports from TikTok Ads Manager and the parser drops the parsed snapshot into snapshot_json. The source column lets us swap manual rows for live API rows without changing the read surface.';
comment on column tiktok_manual_reports.campaign_name is
  'Campaign label as it appears on the TikTok export, e.g. "[BB26-RIANBRAZIL]". Used for filtering / dedupe — not normalised against tiktok_accounts.';
comment on column tiktok_manual_reports.source is
  'Provenance of the snapshot: manual_xlsx (default), manual_csv, or api once OAuth lands.';
comment on column tiktok_manual_reports.snapshot_json is
  'Parsed report payload conforming to TikTokManualReportSnapshot in lib/types/tiktok.ts.';

create index if not exists tiktok_manual_reports_user_imported_idx
  on tiktok_manual_reports (user_id, imported_at desc);

create index if not exists tiktok_manual_reports_event_id_idx
  on tiktok_manual_reports (event_id)
  where event_id is not null;

create index if not exists tiktok_manual_reports_client_id_idx
  on tiktok_manual_reports (client_id)
  where client_id is not null;

create index if not exists tiktok_manual_reports_campaign_name_idx
  on tiktok_manual_reports (campaign_name);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table tiktok_manual_reports enable row level security;

drop policy if exists tiktok_manual_reports_owner_select on tiktok_manual_reports;
create policy tiktok_manual_reports_owner_select on tiktok_manual_reports
  for select using (auth.uid() = user_id);

drop policy if exists tiktok_manual_reports_owner_insert on tiktok_manual_reports;
create policy tiktok_manual_reports_owner_insert on tiktok_manual_reports
  for insert with check (auth.uid() = user_id);

drop policy if exists tiktok_manual_reports_owner_update on tiktok_manual_reports;
create policy tiktok_manual_reports_owner_update on tiktok_manual_reports
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tiktok_manual_reports_owner_delete on tiktok_manual_reports;
create policy tiktok_manual_reports_owner_delete on tiktok_manual_reports
  for delete using (auth.uid() = user_id);

-- ── updated_at touch trigger ──────────────────────────────────────────────
-- Mirrors the pattern from migration 016 (set_tiktok_accounts_updated_at).

create or replace function set_tiktok_manual_reports_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tiktok_manual_reports_set_updated_at on tiktok_manual_reports;
create trigger tiktok_manual_reports_set_updated_at
  before update on tiktok_manual_reports
  for each row execute function set_tiktok_manual_reports_updated_at();

notify pgrst, 'reload schema';
