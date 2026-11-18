-- 263: the creative tests' daily read — the ledger's op kind for moving a test
-- ad set's end date.
--
-- docs/design-record/2026-11-18-creative-testing-6.html, TF6 and HT2: when every
-- variant is above the show's benchmark at day 4 (or a variant earns a second
-- run at day 8), the read job moves the test ad set's end_time out 4 days, to
-- 23:59 London on day 8 (or day 12). Meta v21 keeps the end date on the ad set
-- (a campaign's stop_time is read-only), so it's an ad set write:
--   adset_end_time_update   POST /{adset_id} { end_time }, one per test per
--                           extension, keyed on the test and the extension, so a
--                           retry never extends twice.
-- The stop reuses adset_status_update (237) through lib/meta/adset-status-write.ts.
--
-- The CHECK keeps every kind 156, 179, 180, 236, 237 and 243 installed, and the
-- three the open Retargeting migrations add (257: retargeting_audience_rule_update;
-- 259: retargeting_study_create, retargeting_study_end), so applying this after
-- them never drops a kind they wrote.
--
-- Write only. Unapplied: Matas applies from main.

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
    'refresh_campaign_status_update',
    'retargeting_audience_rule_update',
    'retargeting_study_create',
    'retargeting_study_end',
    'adset_end_time_update'
  ));
