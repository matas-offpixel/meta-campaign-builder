-- Migration 259 — the Retargeting layout test (RT17): its call line and its Meta A/B test on the write ledger
--
-- docs/design-record/2026-11-17-retargeting-campaign-2.html, RT17, with ops'
-- option (c) of 17 Nov for the test's start.
--
-- 1. A new line kind, retargeting_test_call: the pooled call ("Layout {X} wins
--    the retargeting test", or "No clear winner after 28 days") on the
--    Retargeting panel of every show in the test. Accepting it once pauses the
--    losing arm on every show, ends each show's Meta A/B test and gives the
--    winning arm the show's whole total.
-- 2. Two op kinds on meta_write_idempotency: retargeting_study_create (POST
--    /{business_id}/ad_studies, the two arm campaigns as 50 % cells) and
--    retargeting_study_end (the test ended on the call). Main's 263 already
--    added both, so the op_kind CHECK is re-added unchanged: the 22 kinds
--    live on prod (read only, 24 Nov, after 257 and 267 were applied).
--
-- Both CHECKs are dropped by name and re-added with every value they hold
-- live: the line kinds are prod's 11 plus retargeting_test_call; the op
-- kinds drop none of the 22.
--
-- Write only. Not applied from this branch. Ops applies from the PR head.

alter table public.onsale_refresh_lines
  drop constraint if exists onsale_refresh_lines_kind_check;

alter table public.onsale_refresh_lines
  add constraint onsale_refresh_lines_kind_check
  check (kind in ('add_creative', 'claim_ready', 'pause_creative', 'bring_back_audience', 'missing_default', 'drop_audience', 'move_budget', 'purchase_campaign', 'scale_purchase', 'copy_audience', 'retargeting_campaign', 'retargeting_test_call'));

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
    'adset_end_time_update',
    'customer_list_create',
    'customer_list_users'
  ));

notify pgrst, 'reload schema';
