-- Migration 255 — creative testing: test plans, tests, variants, daily reads,
-- the Lab's audio files and snippet renders, and the Spotify top-tracks cache
--
-- docs/design-record/2026-11-16-creative-testing.html (CT1–CT12), as amended
-- by 2026-11-16-creative-testing-2.html (TT1–TT7) and
-- 2026-11-16-creative-testing-3.html (TF1–TF4).
--
-- Additive only: seven new tables, nothing existing is altered.
--
--   creative_test_plans           one per event (CT6).
--   creative_tests                the tests in order. Each changes one thing
--                                 (kind) and runs in the event's Tests
--                                 campaign, in the Video or Statics ad set
--                                 (TT1), or in place in the main ad sets
--                                 (the CT12 copy test). Its budget is TF1's;
--                                 its call is TF2's, stored with evidence.
--   creative_test_variants        the ads under test, and Test 3's control.
--   creative_test_reads           the 08:00 London read (TF2), one per test
--                                 per day, with the per-variant figures and
--                                 the state it gave.
--   creative_lab_audio_files      audio from 02 Source / Audio / {artist}
--                                 (CT2): the Storage copy, the format checks,
--                                 who supplied it, the Spotify match (CT3),
--                                 the drop and window (CT4), and the rights
--                                 flag (TT5).
--   creative_lab_snippet_renders  the 9:16 snippet renders (CT1, CT5, CT10).
--                                 Its own table: creative_lab_renders needs
--                                 a clip and a caption, and a snippet has
--                                 neither.
--   spotify_top_tracks_cache      Spotify's top tracks per act, kept a day
--                                 (CT3).
--
-- Who can do what: owner-only RLS on user_id, the same as the Creative Lab
-- tables (197). The crons and the apply routes write with the service role.
-- Every table also gets 251's restrictive client-member write guard, so a
-- client_users session can't insert, update or delete here.
--
-- Write only. Not applied from this branch. Matas applies from main, before
-- the merge. Idempotent.

-- ---------------------------------------------------------------------------
-- The plan
-- ---------------------------------------------------------------------------

create table if not exists public.creative_test_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  event_id    uuid not null references public.events (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id)
);

comment on table public.creative_test_plans is
  'CT6: one test plan per event, holding its tests in order. Migration 255.';

-- ---------------------------------------------------------------------------
-- The tests
-- ---------------------------------------------------------------------------

create table if not exists public.creative_tests (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  plan_id                uuid not null references public.creative_test_plans (id) on delete cascade,
  event_id               uuid not null references public.events (id) on delete cascade,
  n                      integer not null check (n >= 1),
  kind                   text not null check (kind in ('tracks', 'statics', 'together', 'copy', 'clip')),
  format                 text not null check (format in ('video', 'statics')),
  runs_in                text not null default 'tests_adset' check (runs_in in ('tests_adset', 'main_adsets')),
  result_event           text check (result_event in ('initiate_checkout', 'landing_page_view', 'complete_registration')),
  held                   jsonb not null default '{}',
  state                  text not null default 'waiting' check (state in (
                           'waiting', 'making', 'approved', 'running',
                           'called', 'no_clear_winner', 'not_enough_variants', 'ended'
                         )),
  -- TF1, sized when the test starts.
  currency               text,
  current_daily_spend    numeric(12, 2),
  daily_budget_minor     integer check (daily_budget_minor is null or daily_budget_minor > 0),
  budget_pct             numeric(6, 2),
  at_minimum             boolean not null default false,
  min_daily_budget_minor integer,
  median_cap_minor       integer,
  hold_minor             integer,
  sized_at               timestamptz,
  -- Meta (approve creates everything paused; Start turns it live).
  ad_account_id          text,
  meta_campaign_id       text,
  meta_adset_id          text,
  approved_by            uuid,
  approved_at            timestamptz,
  started_by             uuid,
  started_at             timestamptz,
  first_delivery_at      timestamptz,
  ended_at               timestamptz,
  -- The call (TF2), Matas's click, with its evidence.
  winner_variant_id      uuid,
  called_by              uuid,
  called_at              timestamptz,
  call_evidence          jsonb,
  proposal_id            uuid references public.onsale_refresh_proposals (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (plan_id, n)
);

comment on table public.creative_tests is
  'CT6 / TT1: a test in an event''s plan. Changes one thing (kind) and holds the rest (held). Migration 255.';
comment on column public.creative_tests.format is
  'TT1: video (anything with sound or motion, every audio snippet static) or statics (still images). Picks the Tests ad set.';
comment on column public.creative_tests.runs_in is
  'tests_adset: the event''s {code} · Tests campaign, in the format''s ad set (TT1). main_adsets: measured in place in the main ad sets (the CT12 copy test, no Tests campaign).';
comment on column public.creative_tests.state is
  'waiting: an earlier test (or one of the same format) holds it. making: its variants are being made. approved: Approve variants created it on Meta, paused. running: Start turned it live. called / no_clear_winner / not_enough_variants: how it ended (TF2, TT5). ended: paused without a call.';
comment on column public.creative_tests.daily_budget_minor is
  'TF1: 10 % of current daily spend, rounded down to the whole unit, at most 10 and the median live main ad set, at least Meta''s minimum. Minor units of currency.';
comment on column public.creative_tests.hold_minor is
  'TF1: 4 days of the daily budget, held against the plan (R5) from Start. Pausing returns what''s unspent.';
comment on column public.creative_tests.first_delivery_at is
  'TF2: the reads count from here. The first read is 48 h after it; day 4 is 96 h.';
comment on column public.creative_tests.call_evidence is
  'TF2: the read the call was made on (shares, spend, results, cost per result per variant), kept for R6.';

create index if not exists creative_tests_event_idx on public.creative_tests (event_id, n);
create index if not exists creative_tests_running_idx on public.creative_tests (state) where state = 'running';

-- ---------------------------------------------------------------------------
-- The variants
-- ---------------------------------------------------------------------------

create table if not exists public.creative_test_variants (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  test_id            uuid not null references public.creative_tests (id) on delete cascade,
  position           integer not null,
  role               text not null default 'variant' check (role in ('variant', 'control')),
  label              text not null,
  source             jsonb not null default '{}',
  snippet_render_id  uuid,
  meta_creative_id   text,
  meta_ad_id         text,
  state              text not null default 'pending' check (state in ('pending', 'created', 'live', 'paused', 'muted')),
  muted_at           timestamptz,
  mute_raw           jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (test_id, position)
);

comment on table public.creative_test_variants is
  'The ads a test compares. label is the track title, the static''s name or the copy''s first line (CT11). role control is Test 3''s copy of the main campaign''s best ad (TT1). Migration 255.';
comment on column public.creative_test_variants.source is
  'What the ad is made from: a snippet render, a Drive static, or (control, copy test) an existing ad and its post.';
comment on column public.creative_test_variants.mute_raw is
  'TT5: Meta''s raw response (issues_info, effective status, review feedback) when the variant was read as muted or rejected for rights. Kept to confirm the signal on the first real case.';

-- ---------------------------------------------------------------------------
-- The daily reads
-- ---------------------------------------------------------------------------

create table if not exists public.creative_test_reads (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  test_id            uuid not null references public.creative_tests (id) on delete cascade,
  read_day           date not null,
  read_at            timestamptz not null default now(),
  hours              numeric(8, 2),
  spend_total        numeric(12, 2),
  variants           jsonb not null default '[]',
  state              text not null,
  leader_variant_id  uuid,
  winner_variant_id  uuid,
  meta_calls         integer not null default 0,
  not_read           text,
  created_at         timestamptz not null default now(),
  unique (test_id, read_day)
);

comment on table public.creative_test_reads is
  'TF2: the 08:00 London read of a running test, one per test per day. variants holds each variant''s spend, results, share, judged flag and cost per result since first delivery. not_read: why Meta couldn''t be read this run. Migration 255.';

-- ---------------------------------------------------------------------------
-- The Lab's audio files
-- ---------------------------------------------------------------------------

create table if not exists public.creative_lab_audio_files (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  event_id                 uuid not null references public.events (id) on delete cascade,
  artist_id                uuid references public.artists (id) on delete set null,
  drive_file_id            text not null,
  drive_file_name          text not null,
  drive_folder_id          text,
  mime_type                text,
  format                   text,
  bitrate_kbps             integer,
  duration_s               numeric(10, 3),
  sha256                   text,
  storage_path             text,
  unusable_reason          text,
  -- CT2: who supplied it, picked once, with who picked it and when.
  supplier                 text check (supplier in ('client', 'artist_team')),
  supplier_set_by          uuid,
  supplier_set_at          timestamptz,
  -- CT3: the Spotify top track it is, confirmed by an operator.
  spotify_track_id         text,
  spotify_title            text,
  match_state              text not null default 'none' check (match_state in ('none', 'suggested', 'matched')),
  matched_by               uuid,
  matched_at               timestamptz,
  -- CT4: the drop and the snippet window.
  drop_s                   numeric(10, 3),
  drop_source              text check (drop_source in ('lab', 'operator')),
  drop_set_by              uuid,
  drop_set_at              timestamptz,
  window_start_s           numeric(10, 3),
  length_s                 integer not null default 16 check (length_s between 15 and 20),
  waveform                 jsonb,
  -- TT5: the rights flag.
  rights_flag              text,
  rights_flagged_at        timestamptz,
  rights_flag_cleared_by   uuid,
  rights_flag_cleared_at   timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (event_id, drive_file_id)
);

comment on table public.creative_lab_audio_files is
  'CT2–CT4, TT5: an audio file in the event''s 02 Source / Audio / {artist} folder. The Lab reads it there and keeps a copy in Storage; it never moves or deletes the Drive file, and never takes audio from a link. Migration 255.';
comment on column public.creative_lab_audio_files.unusable_reason is
  'CT2: why the file can''t be used ("Can''t use this file: {reason}"). Null when it passes: WAV, AIFF, FLAC, or MP3 at 256 kbps or more, at least 30 seconds.';
comment on column public.creative_lab_audio_files.supplier is
  'CT2: client or artist_team. Null holds the file: "Name who supplied this file before it can run."';
comment on column public.creative_lab_audio_files.drop_source is
  'CT4: lab ("Drop found by the Lab") or operator ("Drop set by {first name}"). Null: no clear drop, and no snippet renders until a marker is placed.';
comment on column public.creative_lab_audio_files.rights_flag is
  'TT5: "Meta muted the audio (rights)" when a variant made from this file was muted or rejected. The file can''t be picked for a new snippet until Matas clears it.';

create index if not exists creative_lab_audio_files_event_idx on public.creative_lab_audio_files (event_id, artist_id);

-- ---------------------------------------------------------------------------
-- The snippet renders
-- ---------------------------------------------------------------------------

create table if not exists public.creative_lab_snippet_renders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  event_id              uuid not null references public.events (id) on delete cascade,
  audio_file_id         uuid not null references public.creative_lab_audio_files (id) on delete cascade,
  purpose               text not null default 'final' check (purpose in ('preview', 'final')),
  static_drive_file_id  text not null,
  static_name           text not null,
  start_s               numeric(10, 3) not null,
  length_s              integer not null check (length_s between 15 and 20),
  test_id               uuid references public.creative_tests (id) on delete set null,
  status                text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed')),
  attempt               integer not null default 0,
  error                 text,
  render_ms             integer,
  storage_path          text,
  creative_asset_id     uuid,
  file_name             text,
  approved_by           uuid,
  approved_at           timestamptz,
  drive_status          text,
  drive_file_id         text,
  drive_error           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.creative_lab_snippet_renders is
  'CT1: the audio snippet static, a 1080 × 1920 video of one 9:16 static held for the snippet. file_name follows CT1''s S14 pattern; it files under Videos for the track''s artist. Migration 255.';

create index if not exists creative_lab_snippet_renders_event_idx on public.creative_lab_snippet_renders (event_id, created_at desc);
create index if not exists creative_lab_snippet_renders_queue_idx on public.creative_lab_snippet_renders (status) where status in ('queued', 'rendering');

-- ---------------------------------------------------------------------------
-- Spotify's top tracks, kept a day
-- ---------------------------------------------------------------------------

create table if not exists public.spotify_top_tracks_cache (
  artist_id   uuid not null references public.artists (id) on delete cascade,
  market      text not null default 'GB',
  user_id     uuid not null references auth.users (id) on delete cascade,
  tracks      jsonb not null default '[]',
  fetched_at  timestamptz not null default now(),
  primary key (artist_id, market)
);

comment on table public.spotify_top_tracks_cache is
  'CT3: Spotify''s top tracks for an act (up to 10, Spotify''s order), cached for a day. Migration 255.';

-- ---------------------------------------------------------------------------
-- Owner RLS, updated_at, and 251's client-member write guard
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'creative_test_plans',
    'creative_tests',
    'creative_test_variants',
    'creative_test_reads',
    'creative_lab_audio_files',
    'creative_lab_snippet_renders',
    'spotify_top_tracks_cache'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'owner_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      'owner_all', t);
    execute format('drop policy if exists %I on public.%I', 'client_member_no_insert', t);
    execute format('drop policy if exists %I on public.%I', 'client_member_no_update', t);
    execute format('drop policy if exists %I on public.%I', 'client_member_no_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (not public.is_client_member())',
      'client_member_no_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (not public.is_client_member()) with check (not public.is_client_member())',
      'client_member_no_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (not public.is_client_member())',
      'client_member_no_delete', t);
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['creative_test_plans', 'creative_tests', 'creative_test_variants', 'creative_lab_audio_files', 'creative_lab_snippet_renders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute procedure public.update_updated_at_column()', t || '_updated_at', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
