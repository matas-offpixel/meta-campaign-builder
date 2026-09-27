-- Migration 178 — ledger op for live ad-set targeting updates
--
-- meta_write_idempotency.op_kind is a CHECK. A targeting push records
-- op_kind = 'adset_targeting_update'. Until this is applied, that insert
-- fails the check and the push refuses — it does not POST without a row.
-- Matas applies.

alter table public.meta_write_idempotency
  drop constraint if exists meta_write_idempotency_op_kind_check;

alter table public.meta_write_idempotency
  add constraint meta_write_idempotency_op_kind_check
  check (op_kind in (
    'campaign_create',
    'adset_create',
    'ad_create',
    'creative_upload',
    'adset_targeting_update'
  ));
