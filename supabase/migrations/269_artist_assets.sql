-- Migration 269 — the artist library (AL1, AL2, AL5).
--
-- Record: docs/design-record/2026-11-25-artist-library.html (#1376).
-- Rights (Matas, 25 Nov): promoter-filmed footage stays with that promoter;
-- only artist footage and press kits travel between clients. A render is
-- shareable only if every clip in it is artist-owned.
--
-- Additive only. Written, not applied: ops applies just before merge.
-- Operator-only, like learning_findings (264): service role only, the app
-- and the MCP read through the service role behind OPERATOR_USER_IDS.
-- Share links and /admin/[clientSlug] never read these tables
-- (lib/learning/__tests__/cross-client-guard.test.ts).
-- Idempotent.

-- ─── What we hold on each artist ────────────────────────────────────────────

create table if not exists artist_assets (
  id                uuid primary key default gen_random_uuid(),
  artist_id         uuid not null references artists (id) on delete cascade,
  -- One per thing held: ad:{meta_ad_id}, drive:{file id}, clip:{lab clip id},
  -- render:{lab render id}, caption:{id}. Written by lib/artist-library only.
  asset_key         text not null,
  kind              text not null check (kind in ('clip', 'static', 'render', 'caption')),
  name              text,
  drive_file_id     text,
  storage_path      text,
  caption_text      text,
  source_event_id   uuid references events (id) on delete set null,
  source_client_id  uuid references clients (id) on delete set null,
  owner_kind        text not null check (owner_kind in ('artist', 'promoter', 'offpixel')),
  shareable         boolean not null,
  held_reason       text check (held_reason in ('filmed', 'footage', 'branding', 'names')),
  approved_by       text,
  approved_at       timestamptz,
  logged_by         uuid references auth.users (id) on delete set null,
  lab_clip_id       uuid references creative_lab_clips (id) on delete set null,
  lab_render_id     uuid references creative_lab_renders (id) on delete set null,
  meta_ad_id        text,
  launched_ad_id    uuid references launched_ads (id) on delete set null,
  matched_by        text check (matched_by in ('lab', 'drive', 'event_artists', 'ad_name', 'tag')),
  -- When the material was made or last ran: get_artist's "Newest material" (AL5).
  material_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint artist_assets_key unique (artist_id, asset_key),
  -- Promoter-filmed material never travels (AL1).
  constraint artist_assets_promoter_not_shareable check (not (owner_kind = 'promoter' and shareable)),
  -- A brick badge always has its reason and its client; a shareable one has neither reason.
  constraint artist_assets_reason check (shareable = (held_reason is null)),
  constraint artist_assets_held_client check (shareable or source_client_id is not null),
  -- An artist-voice caption is in the library only with its approval (AL2).
  constraint artist_assets_caption_approved check (kind <> 'caption' or (caption_text is not null and approved_by is not null and approved_at is not null))
);

comment on table artist_assets is
  'The artist library (AL2): every clip, static, render and caption held for an artist, and the ads they ran as. Operator-only: service role only. Migration 269.';
comment on column artist_assets.asset_key is
  'What the row holds, unique per artist: ad:{meta_ad_id}, drive:{file id}, clip:{lab clip id}, render:{lab render id}, caption:{id}. Migration 269.';
comment on column artist_assets.owner_kind is
  'artist: the artist''s own material or a press kit. promoter: filmed, branded or made by the client. offpixel: made by Off/Pixel (a Lab render, our copy). Migration 269.';
comment on column artist_assets.shareable is
  'true: any client can use it. false: it stays with source_client_id (the brick badge). Never true for a promoter row; a render is true only when every clip in it is artist-owned. Migration 269.';
comment on column artist_assets.held_reason is
  'Why a row stays with its client (AL1, the first that applies): filmed, footage (a render with a promoter clip in it), branding, names (a caption or copy line naming the client''s venue or brand). Null when shareable. Migration 269.';
comment on column artist_assets.approved_by is
  'Who approved an artist-voice caption, as written (e.g. the artist''s team). Migration 269.';
comment on column artist_assets.logged_by is
  'The operator who logged the approval. Migration 269.';
comment on column artist_assets.meta_ad_id is
  'The Meta ad this row ran as, when it did. Spend and results are read from ad_daily_insights by this id, never stored here. Migration 269.';
comment on column artist_assets.matched_by is
  'How the backfill tied an ad to the artist: lab, drive, event_artists, ad_name or tag (creative_tag_assignments). Migration 269.';

create index if not exists artist_assets_artist_idx on artist_assets (artist_id, kind);
create index if not exists artist_assets_meta_ad_idx on artist_assets (meta_ad_id) where meta_ad_id is not null;
create index if not exists artist_assets_drive_file_idx on artist_assets (drive_file_id) where drive_file_id is not null;
create index if not exists artist_assets_source_event_idx on artist_assets (source_event_id);

alter table artist_assets enable row level security;

-- ─── The Drive library's folder map (AL1, AL4) ──────────────────────────────
--
-- 00 Artist Library / {artist} / Clips · Statics · Renders · Captions · Insights,
-- at the Off / Pixel shared drive's root. drive_folders (218) keys on a
-- client, so the library keeps its own map. The root row has artist_id null.

create table if not exists artist_library_folders (
  id               uuid primary key default gen_random_uuid(),
  artist_id        uuid references artists (id) on delete cascade,
  key              text not null,
  name             text not null,
  drive_folder_id  text not null,
  created_at       timestamptz not null default now(),
  constraint artist_library_folders_key unique nulls not distinct (artist_id, key)
);

comment on table artist_library_folders is
  'The Drive library''s folder map (AL1): key root (artist_id null), artist, clips, statics, renders, captions, insights. Never shared outside Off/Pixel: Share with promoter refuses any folder in this map. Service role only. Migration 269.';

create unique index if not exists artist_library_folders_drive_id on artist_library_folders (drive_folder_id);

alter table artist_library_folders enable row level security;

-- ─── Service role only ──────────────────────────────────────────────────────

revoke all on artist_assets from anon, authenticated;
revoke all on artist_library_folders from anon, authenticated;

do $$
begin
  -- A policy of false, not the absence of a policy: a later grant of
  -- authenticated SELECT still matches nothing (as 264).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'artist_assets' and policyname = 'artist_assets no authenticated read'
  ) then
    execute 'create policy "artist_assets no authenticated read" on artist_assets for select to authenticated using (false)';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'artist_library_folders' and policyname = 'artist_library_folders no authenticated read'
  ) then
    execute 'create policy "artist_library_folders no authenticated read" on artist_library_folders for select to authenticated using (false)';
  end if;
end $$;

notify pgrst, 'reload schema';
