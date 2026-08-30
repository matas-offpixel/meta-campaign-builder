-- Per-client opt-in for Bannerbear rendering (4theFans fan-park v1). Global
-- FEATURE_BANNERBEAR must also be on for the provider to work.
--
-- Note: 042 in this repo is `042_d2c_encrypted_credentials.sql`.

alter table clients
  add column if not exists bannerbear_enabled boolean not null default false;

comment on column clients.bannerbear_enabled is
  'When true (and FEATURE_BANNERBEAR in env), this client can trigger Bannerbear renders.';

notify pgrst, 'reload schema';
