-- Migration 237 — the on-sale refresh, P3: audiences and budget
--
-- docs/design-record/2026-11-12-on-sale-refresh.html, R4, R5, HR4.
-- Two new op kinds on the Meta write ledger, so a double click or a retry
-- never re-sends a write:
--   adset_status_update          the gated ad-set status write
--                                (lib/meta/adset-status-write.ts): Bring back
--                                and Drop.
--   refresh_adset_budget_update  one side of a within-campaign budget move
--                                (the optimisation budget write's POST).
-- The CHECK keeps every kind 156, 179, 180 and 236 installed.
--
-- 236 is applied. 234 (#1217) and 235 (#1218) are open and unapplied;
-- 237 goes after them. It touches only meta_write_idempotency's CHECK, so
-- it does not depend on either.
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
    'refresh_adset_budget_update'
  ));

notify pgrst, 'reload schema';
