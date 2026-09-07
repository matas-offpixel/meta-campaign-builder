-- Migration 172 — events.meta_ad_account_id (G35)
--
-- The column exists in production but not in schema.sql or any
-- migration. `add column if not exists` is a no-op on prod. The
-- resolver prefers this event's own ad account over the client default.
--
-- Apply after review. Do not apply in this run.

alter table events
  add column if not exists meta_ad_account_id text;

comment on column events.meta_ad_account_id is
  'The event''s own Meta ad account (numeric id, no act_ prefix). The resolver prefers this over the client default.';
