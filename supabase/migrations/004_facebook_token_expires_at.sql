-- Migration 004: add expires_at to user_facebook_tokens
--
-- Stores the token's expiry so launch diagnostics can detect expired tokens
-- before making any Meta API calls.  Nullable — existing rows simply have no
-- expiry recorded yet; they will be populated on the next reconnect.

alter table user_facebook_tokens
  add column if not exists expires_at timestamptz;
