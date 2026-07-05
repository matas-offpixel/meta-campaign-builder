-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 139 — landing_page_modules (OP909 Admin Sprint 1, PR 2)
--
-- Promotes the fan-facing landing page from a fixed set of presentation
-- columns (hero_images / youtube_url / bottom_images + content.brand_*) to
-- an ordered `modules` array, plus per-page `visibility` toggles and a
-- `customisation` bag. All three are additive JSONB columns with safe
-- defaults, so the pre-deploy renderer (which never reads them) is
-- unaffected, and the post-deploy renderer falls back to the legacy columns
-- byte-for-byte whenever `modules` is empty (see lib/landing-pages/modules.ts).
--
-- `modules` element shape (validated in the app, not the DB — JSONB stays
-- permissive so a future module type needs no migration):
--   { "id": uuid-text, "type": "hero_carousel" | "youtube_embed"
--         | "image_grid" | "brand_socials" | "custom_text",
--     "enabled": bool, "order": int, "config": { … } }
--
-- Backfill (idempotent — only touches rows still at the '[]' / '{}' default):
--   modules      ← reconstructed from the legacy columns in render order
--                  (hero → youtube → image grid → brand socials), so an
--                  existing page resolves to the exact same content.
--   visibility   ← everything visible; show_countdown mirrors whether a
--                  countdown target is set (matches the renderer's gate).
--   customisation← left '{}' (renderer defaults: accent button, left-aligned
--                  description) — no per-page overrides existed pre-139.
--
-- Rollback:
--   alter table page_events
--     drop column if exists modules,
--     drop column if exists visibility,
--     drop column if exists customisation;
-- ─────────────────────────────────────────────────────────────────────────────

alter table page_events
  add column if not exists modules jsonb not null default '[]'::jsonb,
  add column if not exists visibility jsonb not null default '{}'::jsonb,
  add column if not exists customisation jsonb not null default '{}'::jsonb;

-- ── Backfill modules from the legacy presentation columns ───────────────────
-- One UPDATE, driven by a LATERAL VALUES list of candidate module objects.
-- NULL candidates (legacy column empty) are filtered out and the survivors
-- are aggregated in render order. The fixed `order` values (0..3) may have
-- gaps when a legacy field is absent — that is harmless: the app resolver
-- sorts by `order` and gaps never affect the render sequence.
update page_events pe
set modules = coalesce(sub.arr, '[]'::jsonb)
from (
  select
    src.id,
    jsonb_agg(elem.m order by (elem.m->>'order')::int) as arr
  from page_events src
  cross join lateral (
    values
      (case
         when jsonb_typeof(src.hero_images) = 'array'
              and jsonb_array_length(src.hero_images) > 0
         then jsonb_build_object(
           'id', gen_random_uuid()::text,
           'type', 'hero_carousel',
           'enabled', true,
           'order', 0,
           'config', jsonb_build_object('images', src.hero_images)
         )
       end),
      (case
         when src.youtube_url is not null and length(trim(src.youtube_url)) > 0
         then jsonb_build_object(
           'id', gen_random_uuid()::text,
           'type', 'youtube_embed',
           'enabled', true,
           'order', 1,
           'config', jsonb_build_object('url', src.youtube_url)
         )
       end),
      (case
         when jsonb_typeof(src.bottom_images) = 'array'
              and jsonb_array_length(src.bottom_images) > 0
         then jsonb_build_object(
           'id', gen_random_uuid()::text,
           'type', 'image_grid',
           'enabled', true,
           'order', 2,
           'config', jsonb_build_object('images', src.bottom_images)
         )
       end),
      (case
         when nullif(trim(coalesce(src.content->>'brand_instagram_url', '')), '') is not null
              or nullif(trim(coalesce(src.content->>'brand_tiktok_url', '')), '') is not null
         then jsonb_build_object(
           'id', gen_random_uuid()::text,
           'type', 'brand_socials',
           'enabled', true,
           'order', 3,
           'config', jsonb_build_object(
             'instagram_url', src.content->>'brand_instagram_url',
             'tiktok_url', src.content->>'brand_tiktok_url'
           )
         )
       end)
  ) as elem(m)
  where elem.m is not null
  group by src.id
) sub
where pe.id = sub.id
  and pe.modules = '[]'::jsonb;

-- ── Backfill visibility (everything on; countdown mirrors the target) ───────
update page_events
set visibility = jsonb_build_object(
  'show_event_date', true,
  'show_venue', true,
  'show_description', true,
  'show_presale', true,
  'show_countdown', countdown_target_at is not null
)
where visibility = '{}'::jsonb;
