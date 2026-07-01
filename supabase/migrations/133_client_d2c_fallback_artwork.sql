-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 133 — per-client D2C fallback artwork URL.
--
-- Layer 8 of the 2026-07-01 direct-fire incident: the Jackies Mallorca event
-- (160fbb1c-a4be-4435-a53d-a690c9edf895) had d2c_event_copy.artwork_url = null,
-- but the WhatsApp autoresp_setup template REQUIRES event_artwork_url. With no
-- artwork the template send would fail on a required variable.
--
-- resolveEventArtwork() already walks event copy → asset queue → Bird media.
-- This column adds a final deterministic fallback: a per-client placeholder
-- (e.g. the client's logo card) so a missing per-event poster degrades to a
-- brand-safe image instead of a hard failure. The resolver stores the resolved
-- URL back onto d2c_event_copy.artwork_url so subsequent sends skip the chain.
--
-- NOTE: migrations 131 (pgcrypto extension + schema move) and 132 (credential
-- re-encryption) were applied directly to prod as ops artifacts during the
-- 2026-07-01 incident and are intentionally NOT committed as files. See
-- docs/D2C_LIVE_FIRE_RUNBOOK.md layers 1-5. Do not attempt to recreate them.
--
-- Reversibility:
--   alter table clients drop column if exists d2c_fallback_artwork_url;
-- ─────────────────────────────────────────────────────────────────────────────

alter table clients
  add column if not exists d2c_fallback_artwork_url text;

comment on column clients.d2c_fallback_artwork_url is
  'Per-client fallback artwork URL used by resolveEventArtwork() when no per-event poster is found (event copy / asset queue / Bird media all miss). Should be a public, directly-fetchable image URL (brand card / logo). Optional; null means the resolver throws AssetUnresolvedError instead of degrading.';

notify pgrst, 'reload schema';
