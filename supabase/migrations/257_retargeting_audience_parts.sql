-- Migration 257 — the Retargeting campaign's stored audiences, one row per window,
-- and its daily rule rewrite on the Meta write ledger
--
-- docs/design-record/2026-11-17-retargeting-campaign.html (RT2) and
-- docs/design-record/2026-11-17-retargeting-campaign-2.html (RT13, RT14).
--
-- The Retargeting campaign's Apply (lib/retargeting/apply.ts) stores each
-- tier audience it builds in onsale_refresh_audiences under
-- kind = 'retargeting_campaign', with `part` set to the audience's stable key
-- ("bottom:ticket:7", "mid_bottom:page:60", "mid:video:{page}:1:90", …), so a
-- Retry reuses it instead of building a second one. Migration 237's part
-- CHECK allows only the refresh's six parts, so that insert would fail.
--
-- The check now keeps the six parts for every other kind and lets a
-- retargeting_campaign row carry its key. Every existing row passes: on
-- 17 Nov prod held only retargeting and registrations_lookalike rows, all
-- on the six parts.
--
-- The live definition is "CHECK ((part = ANY (ARRAY[...])))", so the old
-- check is dropped by name, not matched on its text (see 256).
--
-- 2. RT13's daily rule rewrite (ops, 17 Nov: the refresh's token and write
-- path, behind its gates) records each POST /{audience} { rule } on
-- meta_write_idempotency as op_kind 'retargeting_audience_rule_update'.
-- Main's 263 already added that kind (with the layout test's two study kinds
-- and its own adset_end_time_update), and prod holds all 20 (read only,
-- 24 Nov). So the op_kind CHECK is re-added with exactly those 20: applying
-- this after 263 changes nothing there, and drops no kind 263 added.
-- Dropped by name, as above.
--
-- Write only. Not applied from this branch. Ops applies from the PR head.

alter table public.onsale_refresh_audiences
  drop constraint if exists onsale_refresh_audiences_part_check;

alter table public.onsale_refresh_audiences
  add constraint onsale_refresh_audiences_part_check
  check (
    part in ('landing', 'ticket', 'video', 'registrations', 'lookalike', 'adset')
    or (kind = 'retargeting_campaign' and length(part) between 1 and 200)
  );

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

notify pgrst, 'reload schema';
