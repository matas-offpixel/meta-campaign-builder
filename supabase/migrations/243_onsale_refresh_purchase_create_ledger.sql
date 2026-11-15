-- Migration 243 — the on-sale refresh, P4 PR B: the Purchase campaign's create path
--
-- docs/design-record/2026-11-14-purchase-campaigns.html, PC3 and HP3.
--
-- Four new op kinds on the Meta write ledger, so a double click or a Retry
-- never re-sends a write and never makes a second campaign:
--   refresh_custom_conversion_create         step 1 (own-domain path only):
--                                            E1's per-show custom conversion.
--   refresh_campaign_create                  step 2: the Purchase campaign,
--                                            paused, CBO lifetime. Keyed on
--                                            the line, so Retry reuses it.
--   refresh_campaign_lifetime_budget_update  step 5: the main campaign's
--                                            lifetime budget, lowered (R4's
--                                            lifetime_budget write; PC4 uses
--                                            it too).
--   refresh_campaign_status_update           step 6: the campaign set active.
-- Steps 3 and 4 reuse refresh_adset_create and refresh_ad_create (237 / 236);
-- step 6's ad sets reuse adset_status_update (237).
--
-- The CHECK keeps every kind 156, 179, 180, 236 and 237 installed.
--
-- 242 (#1238, PR A) adds the line kind; this PR is stacked on it.
--
-- Write only. Not applied from this branch. Ops applies from main.

alter table public.meta_write_idempotency
  drop constraint if exists meta_write_idempotency_op_kind_check;

alter table public.meta_write_idempotency
  add constraint meta_write_idempotency_op_kind_check
  check (op_kind in (
    'campaign_create',
    'adset_create',
    'ad_create',
    'creative_upload',
    'adset_targeting_update',
    'adset_destination_update',
    'refresh_creative_create',
    'refresh_ad_create',
    'ad_status_update',
    'adset_status_update',
    'refresh_adset_budget_update',
    'refresh_adset_create',
    'refresh_custom_conversion_create',
    'refresh_campaign_create',
    'refresh_campaign_lifetime_budget_update',
    'refresh_campaign_status_update'
  ));
