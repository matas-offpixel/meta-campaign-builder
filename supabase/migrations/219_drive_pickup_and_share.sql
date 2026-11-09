-- Migration 219 — Drive → app pickup (HS14) and share with promoter (HS17).
--
-- Write only. Not applied from this branch; Matas applies.
-- Record: docs/design-record/2026-11-09-creative-lab-clip-selection.html,
-- S22, S25, HS14, HS17. Follows migration 218 (the tree and the folder map).

-- ─── The changes feed cursor (HS14) ─────────────────────────────────────────

create table if not exists drive_change_cursors (
  drive_id    text primary key,
  page_token  text not null,
  updated_at  timestamptz not null default now()
);

comment on table drive_change_cursors is
  'The stored changes.list page token per Shared Drive. The pickup cron reads from it and stores the next one; the first run stores the drive''s start token and imports nothing older. Service-role only. Migration 219.';

alter table drive_change_cursors enable row level security;
-- No policies: service role only.

-- ─── Kit-audit queue (S22, HS14) ────────────────────────────────────────────

create table if not exists drive_kit_audit_files (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients (id) on delete cascade,
  event_id       uuid references events (id) on delete cascade,
  drive_file_id  text not null unique,
  name           text not null,
  mime_type      text,
  folder_key     text not null,
  seen_at        timestamptz not null default now(),
  audited_at     timestamptz
);

create index if not exists drive_kit_audit_files_client_idx on drive_kit_audit_files (client_id);
create index if not exists drive_kit_audit_files_event_idx on drive_kit_audit_files (event_id);

comment on table drive_kit_audit_files is
  'A file that appeared in an event''s 01 Open files or a client''s _Brand kit, waiting for the kit audit (H8). One row per Drive file; seen_at is the first sighting. Nothing runs the audit yet; audited_at stays null until it does. Migration 219.';
comment on column drive_kit_audit_files.event_id is
  'Null for a client''s _Brand kit file. Migration 219.';
comment on column drive_kit_audit_files.folder_key is
  'The drive_folders key it was found under: 01 or brand-kit. Migration 219.';

alter table drive_kit_audit_files enable row level security;

drop policy if exists "Owners read their drive_kit_audit_files" on drive_kit_audit_files;
create policy "Owners read their drive_kit_audit_files"
  on drive_kit_audit_files
  for select
  to authenticated
  using (
    exists (
      select 1 from clients c
      where c.id = drive_kit_audit_files.client_id
        and c.user_id = auth.uid()
    )
  );

-- ─── Artist clips folders that match no artist (S22) ────────────────────────

create table if not exists drive_artist_folder_misses (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events (id) on delete cascade,
  drive_folder_id  text not null,
  folder_name      text not null,
  seen_at          timestamptz not null default now(),
  unique (event_id, drive_folder_id)
);

comment on table drive_artist_folder_misses is
  'A folder in an event''s 02 Source / Artist clips whose name matches no lineup artist exactly (no trim, no case-fold). Nothing in it was imported. The event page says so once: "A folder in Artist clips matches no artist: ''{folder_name}'' — rename it to the artist''s name." Migration 219.';

alter table drive_artist_folder_misses enable row level security;

drop policy if exists "Owners read their drive_artist_folder_misses" on drive_artist_folder_misses;
create policy "Owners read their drive_artist_folder_misses"
  on drive_artist_folder_misses
  for select
  to authenticated
  using (
    exists (
      select 1 from events e
      where e.id = drive_artist_folder_misses.event_id
        and e.user_id = auth.uid()
    )
  );

-- ─── Share with promoter (HS17) ─────────────────────────────────────────────

alter table events
  add column if not exists drive_shared_with text;

comment on column events.drive_shared_with is
  'The email the event folder is shared with, view only (S25). Set with drive_shared_at / drive_shared_by / drive_share_permission_id (migration 218); all four clear on Stop sharing. Migration 219.';

notify pgrst, 'reload schema';
