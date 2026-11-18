-- Migration 262 — the Creative Lab "Top tracks" reel
-- (docs/design-record/2026-11-18-creative-lab-top-tracks.html, TK1–TK11, and
-- issue 2, 2026-11-18-creative-lab-top-tracks-2.html, TK12–TK18).
--
-- Adds:
--   creative_lab_audio_files      the file's analysis (issue 2, TK18:
--                                 Beat This!'s beats and downbeats, the
--                                 Demucs bass stem's per-beat levels, R and
--                                 the drops — data only, never the stem's
--                                 audio), keyed by the Drive id and Drive's
--                                 modified time, its state, which choice made
--                                 the drop (TK15), and the HOOK marker with
--                                 who set or cleared it.
--   creative_lab_top_tracks_renders  one row per Top tracks reel (TK1): its
--                                 options, its ordered tracks with each
--                                 window, the background, the render and its
--                                 filing. Its own table, as the snippet's
--                                 is: creative_lab_renders needs a clip and
--                                 a caption, and a reel can have neither.
--   creative_tests.kind           'top_tracks' (TK11's rounds), and
--   creative_test_variants        top_tracks_render_id, the reel an ad is.
--
-- Who can do what: owner-only RLS on user_id and 251's restrictive
-- client-member write guard, as 255's tables. The routes and the render
-- tick write with the service role.
--
-- Write only. Not applied from this branch. Matas applies from main, before
-- the merge. Additive and idempotent.

-- ---------------------------------------------------------------------------
-- 1. The analysis, the drop's choice and the hook on the audio file (TK3, TK13–TK18)
-- ---------------------------------------------------------------------------

alter table public.creative_lab_audio_files
  add column if not exists analysis       jsonb,
  add column if not exists analysis_key   text,
  add column if not exists analysis_state text,
  add column if not exists drop_choice    text,
  add column if not exists hook_s      numeric(10, 3),
  add column if not exists hook_source text,
  add column if not exists hook_set_by uuid,
  add column if not exists hook_set_at timestamptz;

alter table public.creative_lab_audio_files drop constraint if exists creative_lab_audio_files_drop_choice_check;
alter table public.creative_lab_audio_files
  add constraint creative_lab_audio_files_drop_choice_check
  check (drop_choice is null or drop_choice in ('last', 'earlier'));

alter table public.creative_lab_audio_files drop constraint if exists creative_lab_audio_files_analysis_state_check;
alter table public.creative_lab_audio_files
  add constraint creative_lab_audio_files_analysis_state_check
  check (analysis_state is null or analysis_state in ('running', 'done', 'failed'));

alter table public.creative_lab_audio_files drop constraint if exists creative_lab_audio_files_hook_source_check;
alter table public.creative_lab_audio_files
  add constraint creative_lab_audio_files_hook_source_check
  check (hook_source is null or hook_source in ('lab', 'operator', 'cleared'));

alter table public.creative_lab_audio_files drop constraint if exists creative_lab_audio_files_hook_s_check;
alter table public.creative_lab_audio_files
  add constraint creative_lab_audio_files_hook_s_check
  check (hook_s is null or hook_s >= 0);

comment on column public.creative_lab_audio_files.analysis is
  'TK18. {v: 2, durationS, beats, downbeats, bassBeatDb (the Demucs bass stem''s RMS per beat, dB), R, drops: [{tS, breakBars, breakFromS, breakToS, breakDb, testDb}], breaks, grid} or {v: 2, error}. Data only: the stem is never stored as audio. Migration 262.';
comment on column public.creative_lab_audio_files.analysis_key is
  'TK18: {drive_file_id}@{Drive modifiedTime}. The analysis runs again when the key changes. Migration 262.';
comment on column public.creative_lab_audio_files.analysis_state is
  'TK18: running ("Finding the drops…", the file can''t be ticked yet), done, or failed ("Couldn''t read this track''s beat — drag the drop marker to it."). Migration 262.';
comment on column public.creative_lab_audio_files.drop_choice is
  'TK15: which rule chose drop_s when the Lab set it — last (the last qualifying drop in the last third) or earlier ("an earlier drop (no later drop fits)"). Null for an operator''s drop. Migration 262.';
comment on column public.creative_lab_audio_files.hook_s is
  'TK3: the HOOK marker, the last place the repeated phrase plays before the chosen drop; null for none. Top tracks only (the snippet static keeps CT1''s window). Migration 262.';
comment on column public.creative_lab_audio_files.hook_source is
  'TK3: lab (found from the file), operator ("Hook set by {first name}") or cleared (the operator removed it). Migration 262.';

-- ---------------------------------------------------------------------------
-- 2. The reel's render rows (TK1, TK10)
-- ---------------------------------------------------------------------------

create table if not exists public.creative_lab_top_tracks_renders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  event_id           uuid not null references public.events (id) on delete cascade,
  artist_id          uuid references public.artists (id) on delete set null,
  framing            text not null check (framing in ('ranked', 'level', 'forever', 'cant-live')),
  track_count        integer not null check (track_count between 3 and 5),
  options            jsonb not null default '{}',
  tracks             jsonb not null default '[]',
  background         jsonb not null default '{}',
  -- The footage owner the reel files under (TK7, W4, D2): one per reel.
  owner_kind         text check (owner_kind in ('artist', 'promoter')),
  stage              text,
  round_no           integer not null default 1 check (round_no >= 1),
  test_id            uuid references public.creative_tests (id) on delete set null,
  status             text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed')),
  attempt            integer not null default 0,
  error              text,
  render_ms          integer,
  duration_s         numeric(10, 3),
  lufs               numeric(6, 2),
  true_peak_db       numeric(6, 2),
  storage_path       text,
  creative_asset_id  uuid,
  file_name          text,
  approved_by        uuid,
  approved_at        timestamptz,
  drive_status       text check (drive_status is null or drive_status in ('copied', 'failed')),
  drive_file_id      text,
  drive_error        text,
  -- AU3 / TK3: Meta muted the audio; every file in the reel is flagged.
  rights_muted_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.creative_lab_top_tracks_renders is
  'TK1: one Top tracks reel, a 9:16 at 1080 × 1920 and nothing else. tracks is the ordered list (play order) of {audioFileId, title, withText, spotifyRank, startS, lengthS, dropS, hookS, cut}. Migration 262.';
comment on column public.creative_lab_top_tracks_renders.options is
  'TK10: {framing, tracks, rowsAppear, ladder, end, endCard, list, background}, defaults first. Migration 262.';
comment on column public.creative_lab_top_tracks_renders.background is
  'TK7: {kind: press | dj | montage | broll, assetIds | clipIds, ...}. One owner per reel. Migration 262.';

create index if not exists creative_lab_top_tracks_renders_event_idx on public.creative_lab_top_tracks_renders (event_id, created_at desc);
create index if not exists creative_lab_top_tracks_renders_queued_idx on public.creative_lab_top_tracks_renders (status) where status in ('queued', 'rendering');

-- ---------------------------------------------------------------------------
-- 3. TK11: the rounds are creative tests of kind top_tracks
-- ---------------------------------------------------------------------------

alter table public.creative_tests drop constraint if exists creative_tests_kind_check;
alter table public.creative_tests
  add constraint creative_tests_kind_check
  check (kind in ('tracks', 'statics', 'together', 'copy', 'clip', 'top_tracks'));

alter table public.creative_test_variants
  add column if not exists top_tracks_render_id uuid references public.creative_lab_top_tracks_renders (id) on delete set null;

comment on column public.creative_test_variants.top_tracks_render_id is
  'TK11: the Top tracks reel this ad is (one ad per variant). Migration 262.';

-- ---------------------------------------------------------------------------
-- Owner RLS, updated_at, and 251's client-member write guard
-- ---------------------------------------------------------------------------

alter table public.creative_lab_top_tracks_renders enable row level security;
drop policy if exists owner_all on public.creative_lab_top_tracks_renders;
create policy owner_all on public.creative_lab_top_tracks_renders
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists client_member_no_insert on public.creative_lab_top_tracks_renders;
drop policy if exists client_member_no_update on public.creative_lab_top_tracks_renders;
drop policy if exists client_member_no_delete on public.creative_lab_top_tracks_renders;
create policy client_member_no_insert on public.creative_lab_top_tracks_renders
  as restrictive for insert to authenticated with check (not public.is_client_member());
create policy client_member_no_update on public.creative_lab_top_tracks_renders
  as restrictive for update to authenticated using (not public.is_client_member()) with check (not public.is_client_member());
create policy client_member_no_delete on public.creative_lab_top_tracks_renders
  as restrictive for delete to authenticated using (not public.is_client_member());

drop trigger if exists creative_lab_top_tracks_renders_updated_at on public.creative_lab_top_tracks_renders;
create trigger creative_lab_top_tracks_renders_updated_at
  before update on public.creative_lab_top_tracks_renders
  for each row execute procedure public.update_updated_at_column();
