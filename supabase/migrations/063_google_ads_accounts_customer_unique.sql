-- Migration 063 — Unique Google Ads customer rows per user
--
-- OAuth now enumerates every MCC child account. Keep one row per
-- (user_id, google_customer_id) while allowing legacy rows without a customer id.

create unique index if not exists google_ads_accounts_user_customer_unique_idx
  on google_ads_accounts (user_id, google_customer_id)
  where google_customer_id is not null;

notify pgrst, 'reload schema';
