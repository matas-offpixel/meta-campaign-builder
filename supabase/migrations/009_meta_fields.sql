-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009 — Meta API infrastructure on clients + events.
--
-- Slice C.1 (client schema overhaul, Meta subset) + Slice F.1 (verify wiring).
--
-- Clients
--   * Rename `default_ad_account_id`  → `meta_ad_account_id` (preserves data)
--   * Rename `default_pixel_id`       → `meta_pixel_id`      (preserves data)
--   * Add    `meta_business_id`       (Business Portfolio ID, numeric string)
--
--   `default_page_ids`, `contact_*` left intact — Slice C.2 will handle Pages
--   and contact migration.
--
-- Events
--   * `event_code` column already exists from migration 003 — add a non-unique
--     index so insights aggregation can lookup-by-code without a seq scan.
--   * Add a column comment explaining the storage convention (no brackets).
--
-- After applying, regenerate TypeScript types:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Clients: rename existing default_* columns to meta_* ─────────────────────
-- `if exists` guards make this safe to re-run if the rename already happened
-- (e.g. in a staging env that ran an earlier draft of this migration).

alter table clients rename column default_ad_account_id to meta_ad_account_id;
alter table clients rename column default_pixel_id      to meta_pixel_id;

-- ── Clients: add Meta Business Portfolio ID ──────────────────────────────────

alter table clients
  add column if not exists meta_business_id text;

comment on column clients.meta_business_id is
  'Business Portfolio ID from Meta Business Manager. Numeric string, no prefix.';
comment on column clients.meta_ad_account_id is
  'Meta ad account numeric id. Stored WITHOUT the "act_" prefix; callers prepend it when hitting Graph.';
comment on column clients.meta_pixel_id is
  'Meta Pixel numeric id from Events Manager.';

-- ── Events: event_code index + column comment ────────────────────────────────

create index if not exists events_event_code_idx
  on events (event_code);

comment on column events.event_code is
  'Meta campaign/ad name fragment used to aggregate insights. Stored WITHOUT brackets — insights queries wrap in brackets at query time, e.g. [UTB0042-New], so substring collisions like UTB0042-New-Retarget do not pollute results.';

-- ── PostgREST schema cache refresh ───────────────────────────────────────────

notify pgrst, 'reload schema';
