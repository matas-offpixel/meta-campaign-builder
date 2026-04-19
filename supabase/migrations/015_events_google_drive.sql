-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 015 — per-event Google Drive folder.
--
-- Adds two columns on events so each event can carry its own Drive
-- folder reference (separate from the client-level folder added in
-- migration 010 via clients.google_drive_folder_url):
--   - google_drive_folder_id  text — Drive folder ID (e.g. "1abcDef...")
--                                    Source of truth for re-fetching the
--                                    URL or pinning sub-folder lookups.
--   - google_drive_folder_url text — Full https://drive.google.com/...
--                                    URL used by the "Open Drive folder"
--                                    button in the event detail UI.
--
-- The two are stored together rather than derived because the URL form
-- can vary (Workspace shared drives, shortcuts, etc) — easier to round-
-- trip the exact link the create-folder API returned than to rebuild it
-- from the id every time.
--
-- No RLS changes required — events RLS already scopes to user_id, and
-- the new columns inherit that policy automatically.
--
-- Auto-create flow lives in /api/integrations/google-drive/create-folder
-- (currently a stub returning "Google Drive not configured" until the
-- googleapis package + GOOGLE_SERVICE_ACCOUNT_JSON env are wired).
--
-- After applying:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

alter table events
  add column if not exists google_drive_folder_id  text,
  add column if not exists google_drive_folder_url text;

comment on column events.google_drive_folder_id is
  'Google Drive folder ID for this event''s working folder (briefs, creative, exports). Set by the create-folder integration; null until provisioned.';
comment on column events.google_drive_folder_url is
  'Full https://drive.google.com URL for this event''s folder. Companion to google_drive_folder_id — stored verbatim so the link the API returned (which may include shared-drive parameters) round-trips intact.';

notify pgrst, 'reload schema';
