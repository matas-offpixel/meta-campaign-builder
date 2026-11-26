-- 273_page_access_request.sql
--
-- Off/Pixel MCP M3c: artist Page access from the client's Business Manager.
--
-- request_page_access asks a Facebook Page for access from the client's own
-- Business Manager (POST /{business_id}/client_pages, as Matas), never from
-- Off/Pixel's (lib/meta/page-access-request.ts). Each request is one
-- meta_write_idempotency row with op_kind 'page_access_request', written
-- with { required: true }; the daily cap (5 a business in 24 hours) counts
-- these rows.
--
-- Additive only: the op_kind CHECK is re-added with every kind live on prod
-- (the 27 read from pg_constraint on 26 Nov 2026, the same list and order as
-- 271 and 259) plus page_access_request. No kind is dropped.
-- lib/mcp/__tests__/migration-273.test.ts pins the list.

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
    'customer_list_users',
    'campaign_status_update',
    'adset_budget_update',
    'campaign_budget_update',
    'object_name_update',
    'ad_study_create',
    'page_access_request'
  ));
