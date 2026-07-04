-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 136 — landing-page Supreme UX (PR 6 of the landing-page arc).
--
-- (The PR brief said "migration 128" — that number predates the PR-1
--  renumbering; repo + prod ledger are through 135. See MIGRATIONS_NOTES.md.)
--
-- 1. event_signups — slim the form: DROP first_name / last_name / city
--    (Supreme-minimal fields; never shipped to a real fan — the GMC test
--    rows are deleted first, below). ADD geo_country / geo_region /
--    geo_city, captured server-side from Vercel's IP-geo headers
--    (x-vercel-ip-*) — coarse, header-derived location for aggregate
--    analytics + Meta CAPI country/st matching. NOT precise geolocation;
--    raw IP is still never stored (ip_hash only, unchanged).
--    NOTE (brief deviation): instagram_handle / tiktok_handle were
--    requested as new columns — they already exist as ig_handle /
--    tt_handle (migration 134) and are reused as-is.
-- 2. client_landing_pages — per-CLIENT presentation config: privacy
--    policy URL, logo style (box logo vs wordmark), Off/Pixel footer
--    attribution toggle, and partner-consent columns (schema-only this
--    PR; no renderer reads them yet).
-- 3. page_events — per-EVENT presentation config: artwork_palette
--    (server-extracted dominant colors), hero_images (carousel),
--    countdown, YouTube embed, bottom image grid.
--    NOTE (brief deviation): the brief put these on `events`. They live
--    on page_events instead — `events` is dashboard-shared territory and
--    has no artwork column (design-doc landmine: artwork comes from
--    page_events.content.artwork_url), so the palette + presentation
--    fields belong on the LP-owned per-event row next to the artwork
--    they describe. Brief-name mapping:
--      artwork_palette             → page_events.artwork_palette
--      landing_page_images         → page_events.hero_images
--      countdown_target_at/label   → page_events.countdown_target_at/label
--      landing_page_youtube_url    → page_events.youtube_url
--      landing_page_bottom_images  → page_events.bottom_images
--
-- Reversibility:
--   alter table event_signups drop column if exists geo_country,
--     drop column if exists geo_region, drop column if exists geo_city;
--   alter table event_signups add column if not exists first_name text,
--     add column if not exists last_name text, add column if not exists city text;
--   alter table client_landing_pages
--     drop column if exists privacy_policy_url, drop column if exists logo_style,
--     drop column if exists box_logo_text,
--     drop column if exists show_off_pixel_attribution,
--     drop column if exists partner_consent_enabled,
--     drop column if exists partner_name,
--     drop column if exists partner_privacy_policy_url;
--   alter table page_events
--     drop column if exists artwork_palette, drop column if exists hero_images,
--     drop column if exists countdown_target_at, drop column if exists countdown_label,
--     drop column if exists youtube_url, drop column if exists bottom_images;
-- (first_name/last_name/city DATA is unrecoverable after the drop — the
--  DELETE below removes the only rows that ever held values.)
--
-- Apply manually post-merge via the Supabase MCP `apply_migration`.
-- Idempotent: every statement is `if not exists` / `if exists` or
-- catalog-checked.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Truncate GMC test rows BEFORE the column drop ────────────────────────
-- Every event_signups row to date is a test signup against GMC Worldwide
-- Productions (the trial client) — no real fan data exists yet. Deleting
-- first makes the name/city column drop lossless in practice.

delete from event_signups
 where client_id = '2f0dbe34-35ce-4df3-a655-32faa6a0f710';

-- ── 1. event_signups — slim fields + coarse geo ──────────────────────────────

alter table event_signups drop column if exists first_name;
alter table event_signups drop column if exists last_name;
alter table event_signups drop column if exists city;

alter table event_signups add column if not exists geo_country text;
alter table event_signups add column if not exists geo_region  text;
alter table event_signups add column if not exists geo_city    text;

comment on column event_signups.geo_country is
  'ISO 3166-1 alpha-2 from Vercel''s x-vercel-ip-country header. Coarse, server-derived; feeds aggregate analytics + Meta CAPI user_data.country (hashed at send time). Migration 136.';
comment on column event_signups.geo_region is
  'Region code from x-vercel-ip-country-region (e.g. ENG). Feeds Meta CAPI user_data.st (hashed at send time). Migration 136.';
comment on column event_signups.geo_city is
  'City name from x-vercel-ip-city (decoded). Coarse IP-derived locality — replaces the dropped self-reported city field. Migration 136.';

-- ── 2. client_landing_pages — presentation + consent config ─────────────────

alter table client_landing_pages
  add column if not exists privacy_policy_url text;
alter table client_landing_pages
  add column if not exists logo_style text not null default 'box_logo';
alter table client_landing_pages
  add column if not exists box_logo_text text;
alter table client_landing_pages
  add column if not exists show_off_pixel_attribution boolean not null default true;
alter table client_landing_pages
  add column if not exists partner_consent_enabled boolean not null default false;
alter table client_landing_pages
  add column if not exists partner_name text;
alter table client_landing_pages
  add column if not exists partner_privacy_policy_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_landing_pages_logo_style_check'
      and conrelid = 'public.client_landing_pages'::regclass
  ) then
    alter table client_landing_pages
      add constraint client_landing_pages_logo_style_check
      check (logo_style in ('box_logo', 'wordmark'));
  end if;
end $$;

comment on column client_landing_pages.privacy_policy_url is
  'The CLIENT''s privacy policy — linked from the signup consent line. Migration 136.';
comment on column client_landing_pages.logo_style is
  '''box_logo'' = accent-colored Supreme-style box (text = box_logo_text); ''wordmark'' = full-width client-name wordmark. Migration 136.';
comment on column client_landing_pages.show_off_pixel_attribution is
  'When true the LP footer renders the "made with off/pixel" attribution block. Migration 136.';
comment on column client_landing_pages.partner_consent_enabled is
  'Schema-only in PR 6 — reserved for a second (partner) consent checkbox; no renderer reads these yet. Migration 136.';

-- ── 3. page_events — per-event presentation ──────────────────────────────────

alter table page_events
  add column if not exists artwork_palette jsonb;
alter table page_events
  add column if not exists hero_images jsonb not null default '[]'::jsonb;
alter table page_events
  add column if not exists countdown_target_at timestamptz;
alter table page_events
  add column if not exists countdown_label text default 'tickets on sale in';
alter table page_events
  add column if not exists youtube_url text;
alter table page_events
  add column if not exists bottom_images jsonb not null default '[]'::jsonb;

comment on column page_events.artwork_palette is
  'Server-extracted dominant colors of the hero artwork, e.g. ["#E27737","#F5B65C","#4B2716"] (primary, secondary, tertiary). Written lazily by the render-time palette hook (lib/landing-pages/palette-extract.ts) — clear to NULL to force re-extraction after artwork changes. Migration 136.';
comment on column page_events.hero_images is
  'Ordered URL array for the hero carousel. Empty → renderer falls back to content.artwork_url as a single image. Migration 136.';
comment on column page_events.countdown_target_at is
  'Countdown block target. NULL (or past) disables the block. Migration 136.';
comment on column page_events.countdown_label is
  'Countdown header label, lowercased mono in the renderer. Migration 136.';
comment on column page_events.youtube_url is
  'YouTube watch/short/embed URL for the bottom lite-embed. NULL hides it. Migration 136.';
comment on column page_events.bottom_images is
  'URL array for the bottom image grid. Empty hides the grid. Migration 136.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification block — raises inside the migration transaction on any miss,
-- so a partial apply is loud and rolls back (PR-1 pattern).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_count int;
begin
  -- Dropped columns are gone.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'event_signups'
    and column_name in ('first_name', 'last_name', 'city');
  if v_count <> 0 then
    raise exception 'migration 136 verification: expected first_name/last_name/city dropped from event_signups, % remain', v_count;
  end if;

  -- Geo columns present.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'event_signups'
    and column_name in ('geo_country', 'geo_region', 'geo_city');
  if v_count <> 3 then
    raise exception 'migration 136 verification: expected 3 geo columns on event_signups, found %', v_count;
  end if;

  -- Handle columns still present (reused, not recreated).
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'event_signups'
    and column_name in ('ig_handle', 'tt_handle');
  if v_count <> 2 then
    raise exception 'migration 136 verification: ig_handle/tt_handle missing from event_signups (found %)', v_count;
  end if;

  -- client_landing_pages presentation columns.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'client_landing_pages'
    and column_name in (
      'privacy_policy_url', 'logo_style', 'box_logo_text',
      'show_off_pixel_attribution', 'partner_consent_enabled',
      'partner_name', 'partner_privacy_policy_url'
    );
  if v_count <> 7 then
    raise exception 'migration 136 verification: expected 7 new client_landing_pages columns, found %', v_count;
  end if;

  -- logo_style CHECK present.
  select count(*) into v_count
  from pg_constraint
  where conname = 'client_landing_pages_logo_style_check'
    and conrelid = 'public.client_landing_pages'::regclass;
  if v_count <> 1 then
    raise exception 'migration 136 verification: logo_style CHECK constraint missing';
  end if;

  -- page_events presentation columns.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'page_events'
    and column_name in (
      'artwork_palette', 'hero_images', 'countdown_target_at',
      'countdown_label', 'youtube_url', 'bottom_images'
    );
  if v_count <> 6 then
    raise exception 'migration 136 verification: expected 6 new page_events columns, found %', v_count;
  end if;

  -- No GMC test signups survive.
  select count(*) into v_count
  from event_signups
  where client_id = '2f0dbe34-35ce-4df3-a655-32faa6a0f710';
  if v_count <> 0 then
    raise exception 'migration 136 verification: % GMC test signup rows survived the delete', v_count;
  end if;

  raise notice 'migration 136 verification: all assertions passed';
end $$;

notify pgrst, 'reload schema';
