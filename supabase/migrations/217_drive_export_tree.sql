-- Migration 217 — the event Drive tree and Lab export (HS10).
--
-- Write only. Not applied from this branch; Matas applies.
-- Record: docs/design-record/2026-11-09-creative-lab-clip-selection.html,
-- S13–S27 and HS9–HS19. Every folder and file lives on the Shared Drive
-- GOOGLE_DRIVE_EXPORT_DRIVE_ID ("Off / Pixel"). Storage stays the source the
-- Meta launch reads; no column added here is read by launch (S27).
--
-- events.google_drive_folder_id / google_drive_folder_url (migration 015) were
-- the stub create-folder route's columns. They are left as they are.
-- events.drive_folder_id is the tree's event folder.

-- ─── Client and event folders ────────────────────────────────────────────────

alter table clients
  add column if not exists drive_folder_id text;

comment on column clients.drive_folder_id is
  'The client''s folder on the Off / Pixel Shared Drive ({Client}/). Null until created. An archived client never gets one created (S27). Migration 217.';

alter table events
  add column if not exists drive_folder_id text,
  add column if not exists drive_folder_linked boolean not null default false,
  add column if not exists drive_shared_at timestamptz,
  add column if not exists drive_shared_by uuid references auth.users (id) on delete set null,
  add column if not exists drive_share_permission_id text,
  add column if not exists drive_cancel_marked_at timestamptz;

comment on column events.drive_folder_id is
  'The event''s folder ({YYYY-MM-DD} {Event name} [{CODE}]) on the Off / Pixel Shared Drive. Null until linked or created (S24). Migration 217.';
comment on column events.drive_folder_linked is
  'true when the operator linked an existing folder (S24 Link), false when the app created the tree. Migration 217.';
comment on column events.drive_shared_at is
  'When the event folder was shared view-only with the client''s contact (S25). Null when not shared. Migration 217.';
comment on column events.drive_shared_by is
  'Who confirmed the share (S25). Migration 217.';
comment on column events.drive_share_permission_id is
  'The Drive permission id the share created; Stop sharing removes this one permission only (HS17). Migration 217.';
comment on column events.drive_cancel_marked_at is
  'When a cancelled event''s folder gained " (cancelled)". Filing stops; nothing is deleted (S27). Migration 217.';

-- ─── The folder map (HS10) ──────────────────────────────────────────────────

create table if not exists drive_folders (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients (id) on delete cascade,
  event_id         uuid references events (id) on delete cascade,
  key              text not null,
  name             text not null,
  drive_folder_id  text not null,
  created_at       timestamptz not null default now()
);

-- One row per (client, event, key); a client-level folder has event_id null.
-- NULLS NOT DISTINCT so two client-level rows for one key cannot exist.
create unique index if not exists drive_folders_client_event_key
  on drive_folders (client_id, event_id, key) nulls not distinct;

create index if not exists drive_folders_event_idx on drive_folders (event_id);

comment on table drive_folders is
  'The folder map every filing resolves through (HS10). key is the tree path in lib/drive/tree.ts: client, brand-kit, event, 00, 01, 02, 02/artist-clips, 03, 03/1/teaser/artist, 03/3/wc/2026-11-16/ugc, winners, … Service-role writes only. Migration 217.';
comment on column drive_folders.name is
  'The name the app last gave the folder in Drive. The tick compares it with the name the client or event record gives today and renames on a difference (S19), without a Drive read. Migration 217.';
comment on column drive_folders.event_id is
  'Null for client-level folders ({Client}/ and _Brand kit). Migration 217.';
comment on column drive_folders.key is
  'Stable path key from lib/drive/tree.ts, never the folder''s display name, so a rename (S19, S27) changes no key. Migration 217.';

alter table drive_folders enable row level security;

drop policy if exists "Owners read their drive_folders" on drive_folders;
create policy "Owners read their drive_folders"
  on drive_folders
  for select
  to authenticated
  using (
    exists (
      select 1 from clients c
      where c.id = drive_folders.client_id
        and c.user_id = auth.uid()
    )
  );

-- ─── Render filing (HS9, HS19) ───────────────────────────────────────────────

alter table creative_lab_renders
  add column if not exists drive_status text,
  add column if not exists drive_file_id text,
  add column if not exists drive_file_name text,
  add column if not exists drive_error text,
  add column if not exists drive_copied_at timestamptz,
  add column if not exists drive_winner_shortcut_id text,
  add column if not exists drive_attempts integer not null default 0,
  add column if not exists drive_next_attempt_at timestamptz,
  add column if not exists drive_render_attempt integer;

alter table creative_lab_renders drop constraint if exists creative_lab_renders_drive_status_check;
alter table creative_lab_renders
  add constraint creative_lab_renders_drive_status_check
  check (drive_status is null or drive_status in ('pending', 'copied', 'failed'));

create index if not exists creative_lab_renders_drive_status_idx
  on creative_lab_renders (drive_status)
  where drive_status is not null;

comment on column creative_lab_renders.drive_status is
  'null before approved (S20); pending while filing; copied once the Drive file landed; failed after three tries (rule 7, "Drive copy failed — retry"). A failed copy never blocks launch. Migration 217.';
comment on column creative_lab_renders.drive_file_id is
  'The Drive file id of the latest copy. Launch never reads it. Migration 217.';
comment on column creative_lab_renders.drive_file_name is
  'The S14 file name the copy has in Drive, _winner included once judged. Migration 217.';
comment on column creative_lab_renders.drive_error is
  'The last filing error, shape only — never a URL or key. Migration 217.';
comment on column creative_lab_renders.drive_copied_at is
  'When the latest copy landed. Migration 217.';
comment on column creative_lab_renders.drive_winner_shortcut_id is
  'The shortcut in {event}/_Winners pointing at this render''s file (S21). Migration 217.';
comment on column creative_lab_renders.drive_attempts is
  'Filing tries since the last success or retry; three, then failed. Migration 217.';
comment on column creative_lab_renders.drive_next_attempt_at is
  'Backoff: the filing tick skips the row until this time. Migration 217.';
comment on column creative_lab_renders.drive_render_attempt is
  'creative_lab_renders.attempt at the last copy. A re-render (attempt moved on) files again as _v{k}, never overwriting (S14). Migration 217.';

-- ─── Asset-bank cells (HS10, HS18) ───────────────────────────────────────────

alter table ticket_warnings
  add column if not exists drive_file_id text;

comment on column ticket_warnings.drive_file_id is
  'The approved warning''s file in that cycle''s Ticket warnings folder (S20). Not written by migration 217''s PR; the asset-bank filing comes later. Migration 217.';

notify pgrst, 'reload schema';
