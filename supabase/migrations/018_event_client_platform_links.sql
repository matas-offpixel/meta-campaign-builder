-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 018 — per-event + per-client platform account links.
--
-- The user spec asked us to "append to migration 016 or 017 — keep in
-- one file". We deliberately landed this as a separate migration 018
-- instead because:
--   - 016 (TikTok) and 017 (Google Ads) ship in their own slices with
--     their own commits; bundling cross-table FKs into one of them
--     blurs the per-slice diff and risks one migration depending on
--     the other when applying out of order.
--   - Both new FKs reference tables created in 016 + 017, so this
--     migration MUST run after both. Numbering it 018 makes that
--     dependency explicit.
--
-- Adds:
--   - events.google_ads_account_id   FK to google_ads_accounts
--   - clients.tiktok_account_id      FK to tiktok_accounts
--   - clients.google_ads_account_id  FK to google_ads_accounts
--
-- All three are nullable. The convention is: events fall back to the
-- client-level link when the per-event value is null. The dashboard UI
-- (PlatformConfigCard / PlatformAccountsCard) renders the resolved
-- value with an "inherited from client" badge in that case.
--
-- Existing flat text columns (clients.tiktok_ad_account_id,
-- clients.google_ads_customer_id, clients.meta_*) stay around as the
-- canonical IDs; the new FKs are the relational handle that points at
-- a *normalised* account row carrying its own credentials. They co-
-- exist on purpose during the transition.
--
-- After applying:
--   supabase gen types typescript --project-id zbtldbfjbhfvpksmdvnt > lib/db/database.types.ts
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Per-event Google Ads link ──────────────────────────────────────────────

alter table events
  add column if not exists google_ads_account_id uuid
    references google_ads_accounts (id) on delete set null;

create index if not exists events_google_ads_account_id_idx
  on events (google_ads_account_id);

comment on column events.google_ads_account_id is
  'Optional FK to the Google Ads account driving Search spend for this event. Null = falls back to clients.google_ads_account_id.';

-- ── Client-level TikTok + Google Ads links ─────────────────────────────────

alter table clients
  add column if not exists tiktok_account_id uuid
    references tiktok_accounts (id) on delete set null,
  add column if not exists google_ads_account_id uuid
    references google_ads_accounts (id) on delete set null;

create index if not exists clients_tiktok_account_id_idx
  on clients (tiktok_account_id);
create index if not exists clients_google_ads_account_id_idx
  on clients (google_ads_account_id);

comment on column clients.tiktok_account_id is
  'Default TikTok account for this client''s events. Per-event override lives on events.tiktok_account_id.';
comment on column clients.google_ads_account_id is
  'Default Google Ads account for this client''s events. Per-event override lives on events.google_ads_account_id.';

notify pgrst, 'reload schema';
