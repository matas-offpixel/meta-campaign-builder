-- Migration 228 — creative_assets: an original kept in Drive as the master.
--
-- Write only. Not applied from this branch; Matas applies from main.
--
-- A clip whose original is over the campaign-assets cap (200 MB a file:
-- the 4K crowd footage from Puzzle's Rossi show is 243–449 MB) can't be
-- stored. The import then stores only the 1080 render copy (migration 220,
-- creative_lab_clips.render_asset_id) and records the original as a
-- creative_assets row whose bytes stay in the event's Drive folder: its
-- Drive file id is drive_file_id, and it has no storage_path.
--
-- No data is dropped. storage_path loses its NOT NULL so that row can
-- exist; the CHECK keeps every row pointing at its bytes somewhere — a
-- Storage path, a Drive file, or both. Every existing row has a
-- storage_path, so the CHECK holds for all of them. Nothing is renamed,
-- rewritten or deleted.

alter table creative_assets
  add column if not exists drive_file_id text;

alter table creative_assets
  alter column storage_path drop not null;

alter table creative_assets drop constraint if exists creative_assets_storage_or_drive_check;
alter table creative_assets
  add constraint creative_assets_storage_or_drive_check
  check (storage_path is not null or drive_file_id is not null);

create index if not exists creative_assets_drive_file_idx on creative_assets (drive_file_id) where drive_file_id is not null;

comment on column creative_assets.drive_file_id is
  'The Drive file holding the original when it is not in Storage (over the campaign-assets cap). Its clip renders from render_asset_id; storage_path is null. Migration 228.';
comment on column creative_assets.storage_path is
  'Path in storage_bucket. Null only for an original kept in Drive (drive_file_id set; the CHECK keeps one of the two). Migration 228.';
