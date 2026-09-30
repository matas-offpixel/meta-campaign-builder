-- Migration 180 — ledger op for live ad-set destination updates
--
-- origin/main's highest numbered migration at this change is 179
-- (179_meta_write_idempotency_adset_targeting.sql), so the next free number
-- is 180. This migration supersedes the CHECK that 179 installs, and so
-- must be applied after it.
--
-- meta_write_idempotency.op_kind is a CHECK. Setting a website destination on
-- a live ad set records op_kind = 'adset_destination_update'. Until this is
-- applied that insert fails the check and the action refuses — it does not
-- POST to Meta without a ledger row (the module passes { required: true }).
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
    'adset_targeting_update',
    'adset_destination_update'
  ));
