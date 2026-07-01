-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 128 — asset-queue source provider discriminant.
--
-- Adds `source` to client_asset_sheet_config so a client's asset queue can be
-- backed by either Dropbox (default / legacy) or Google Drive. The prepare
-- route and the D2C artwork resolver dispatch to the matching provider
-- (lib/clients/asset-queue/provider.ts) on this column.
--
-- Existing rows default to 'dropbox' — no behaviour change until a client is
-- explicitly switched to 'drive'.
--
-- Reversibility:
--   alter table client_asset_sheet_config drop column if exists source;
-- ─────────────────────────────────────────────────────────────────────────────

alter table client_asset_sheet_config
  add column if not exists source text not null default 'dropbox'
    check (source in ('dropbox', 'drive'));

comment on column client_asset_sheet_config.source is
  'Which cloud backs this client''s asset queue: dropbox (default/legacy) or drive (Google Drive service-account, GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON).';

notify pgrst, 'reload schema';
