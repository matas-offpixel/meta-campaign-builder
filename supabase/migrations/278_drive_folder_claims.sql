-- 278_drive_folder_claims.sql
--
-- One builder per Drive folder key. On 27 Nov two walkers of the tree code
-- (lib/drive/folders.ts) ran on one event at once. Both listed the parent by
-- name, neither saw the other's folder made under a second before (Drive's
-- list lags), and both created one: five empty duplicate top-level folders.
--
-- Before it creates a folder for (client_id, event_id, key), a run inserts a
-- claim row here. Only the run whose insert lands (or that takes over a claim
-- older than a minute, a crashed run's) looks the folder up and creates it;
-- it writes drive_folders, then deletes its claim. A run that loses waits and
-- re-reads drive_folders. The claim lives here, not on drive_folders, so
-- every reader of the map stays as it is (drive_folder_id stays not null).
--
-- Same key and NULLS NOT DISTINCT unique index as drive_folders (218), so a
-- client-level key (event_id null) has one claim too. Service role only, like
-- drive_folders' writes: RLS on, no policy. Rows live for about a second;
-- a row left by a crash is taken over after claimed_at + 60 s
-- (claimTiming.ttlMs in lib/drive/folders.ts) and deleted by the run that does.
--
-- Additive: a new table only. No change to drive_folders or any data.

create table if not exists drive_folder_claims (
  client_id    uuid not null references clients (id) on delete cascade,
  event_id     uuid references events (id) on delete cascade,
  key          text not null,
  claim_token  text not null,
  claimed_at   timestamptz not null default now()
);

create unique index if not exists drive_folder_claims_client_event_key
  on drive_folder_claims (client_id, event_id, key) nulls not distinct;

comment on table drive_folder_claims is
  'One run at a time creates a Drive folder for a drive_folders key (27 Nov duplicate folders). Inserted before the lookup and create, deleted after the drive_folders write; a claim older than 60 s is a crashed run''s and is taken over. Service role only. Migration 278.';
comment on column drive_folder_claims.claim_token is
  'Random per claim. Release and takeover match on it, so a run never deletes or overwrites a claim it does not hold. Migration 278.';
comment on column drive_folder_claims.claimed_at is
  'Written by the claiming run (its clock). Older than 60 s means the run is gone. Migration 278.';

alter table drive_folder_claims enable row level security;
