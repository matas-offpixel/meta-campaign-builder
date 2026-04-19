-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010 — Client schema overhaul (Slice C.2).
--
-- Drops the contact_* fields (single-contact-per-client model retired — Matas
-- tracks contacts in WhatsApp + email anyway, the dashboard duplicates them
-- inconsistently) and adds the missing channel + social fields needed for the
-- multi-channel insights aggregator and the lineup / press / social feeds.
--
-- Storage conventions (also in column comments):
--   * tiktok_ad_account_id      — numeric id, no prefix.
--   * google_ads_customer_id    — digits only, NO hyphens (e.g. "1234567890",
--                                 not "123-456-7890"). Hyphens stripped on
--                                 input so the value can be used directly in
--                                 Google Ads API URLs / customer-id headers.
--   * instagram_handle          — handle only, NO leading "@".
--   * tiktok_handle             — handle only, NO leading "@".
--   * facebook_page_handle      — vanity URL slug or handle. The numeric
--                                 page_id continues to live in default_page_ids
--                                 (it's the marketing-API surface; this column
--                                 is for human-readable lookups + share links).
--   * google_drive_folder_url   — full https:// URL, validated client-side.
--
-- After applying, regenerate types:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Drop legacy contact fields ───────────────────────────────────────────────
-- `if exists` keeps the migration replayable on environments where these have
-- already been removed manually.

alter table clients drop column if exists contact_name;
alter table clients drop column if exists contact_email;
alter table clients drop column if exists contact_whatsapp;

-- ── Add channel + social columns ─────────────────────────────────────────────

alter table clients
  add column if not exists tiktok_ad_account_id     text,
  add column if not exists google_ads_customer_id   text,
  add column if not exists instagram_handle         text,
  add column if not exists tiktok_handle            text,
  add column if not exists facebook_page_handle     text,
  add column if not exists google_drive_folder_url  text;

comment on column clients.tiktok_ad_account_id is
  'TikTok Ads Manager advertiser id. Numeric string, no prefix.';
comment on column clients.google_ads_customer_id is
  'Google Ads customer id. Digits only, NO hyphens (strip "123-456-7890" → "1234567890" on input).';
comment on column clients.instagram_handle is
  'Instagram username. Handle only — strip leading "@" on input.';
comment on column clients.tiktok_handle is
  'TikTok username. Handle only — strip leading "@" on input.';
comment on column clients.facebook_page_handle is
  'Facebook Page vanity / handle (human-readable). Numeric page_id stays in default_page_ids — used by the Marketing API.';
comment on column clients.google_drive_folder_url is
  'Full https:// URL to the client''s Google Drive working folder.';

-- ── PostgREST schema cache refresh ───────────────────────────────────────────

notify pgrst, 'reload schema';
