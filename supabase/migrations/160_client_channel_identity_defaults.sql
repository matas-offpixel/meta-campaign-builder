-- Migration 160 — client channel identity defaults
--
-- M.1 of the mirroring plan. Identities the business already knows should
-- be set once per client. This file adds only what is missing.
--
-- Canonical fields that already exist — the defaults layer REFERENCES
-- them, it does not copy them:
--   Facebook page     clients.default_page_ids[1]
--   Meta ad account   clients.meta_ad_account_id
--   TikTok advertiser clients.tiktok_account_id → tiktok_accounts.tiktok_advertiser_id
--                     (fallback clients.tiktok_ad_account_id)
--   Google customer   clients.google_ads_account_id → google_ads_accounts
--                     (fallback clients.google_ads_customer_id)
--
-- New nullable columns: IG actor + TikTok identity (id / type / BC id).
-- RLS is unchanged — these are columns on clients, so
--   "Users can manage their own clients"  (auth.uid() = user_id)
--   "client member reads own client"
-- still apply.
--
-- Foundation only. Apply manually after review. Do not apply in this run.

alter table clients
  add column if not exists default_instagram_actor_id text,
  add column if not exists default_tiktok_identity_id text,
  add column if not exists default_tiktok_identity_type text,
  add column if not exists default_tiktok_identity_bc_id text;

alter table clients drop constraint if exists clients_default_tiktok_identity_type_check;

alter table clients
  add constraint clients_default_tiktok_identity_type_check
  check (
    default_tiktok_identity_type is null
    or default_tiktok_identity_type in (
      'AUTH_CODE',
      'BC_AUTH_TT',
      'CUSTOMIZED_USER',
      'TT_USER',
      'MANUAL'
    )
  );

comment on column clients.default_instagram_actor_id is
  'Default Instagram actor / user id for this client. Paired with default_page_ids[1]. Null = unset.';
comment on column clients.default_tiktok_identity_id is
  'Default TikTok identity_id. Advertiser stays on tiktok_account_id / tiktok_ad_account_id.';
comment on column clients.default_tiktok_identity_type is
  'TikTok identity_type for default_tiktok_identity_id.';
comment on column clients.default_tiktok_identity_bc_id is
  'Business Center id when default_tiktok_identity_type is BC_AUTH_TT.';

notify pgrst, 'reload schema';
