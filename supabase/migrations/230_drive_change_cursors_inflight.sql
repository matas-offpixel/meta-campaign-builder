-- Migration 230 — drive_change_cursors: the file a pickup run is importing.
--
-- Write only. Not applied from this branch; Matas applies from main.
--
-- 11 Nov 2026: two 4K originals (B3B12.mp4 406 MB, SWEELY 1.mp4 449 MB)
-- ran the Drive pickup out of memory. A killed run saves nothing, and
-- Drive's page tokens can't mark a place inside a page, so every 15
-- minutes the next run read the same page and died on the same file.
--
-- Before each clip import the pickup (lib/drive/pickup.ts) writes that
-- file's id here, with how many runs in a row have started it, and clears
-- it when the import returns. A run that finds it still set knows the last
-- run died on that file; after two deaths the file is recorded as failed
-- and skipped, so the page can finish and the cursor moves on.
--
-- Until this is applied the pickup can't write the marker and works as it
-- did before. Three nullable / defaulted columns; nothing is dropped,
-- renamed or rewritten.

alter table drive_change_cursors
  add column if not exists inflight_file_id text,
  add column if not exists inflight_attempts integer not null default 0,
  add column if not exists inflight_started_at timestamptz;

comment on column drive_change_cursors.inflight_file_id is
  'The Drive file id the pickup is importing now; null between files. Still set at the start of a run = the last run was killed on that file. Migration 230.';
comment on column drive_change_cursors.inflight_attempts is
  'How many runs in a row have started importing inflight_file_id. At 2 the next run records the file as failed and skips it (PICKUP_MAX_ATTEMPTS). Migration 230.';
comment on column drive_change_cursors.inflight_started_at is
  'When the current import of inflight_file_id started. Migration 230.';
