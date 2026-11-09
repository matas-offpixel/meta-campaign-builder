-- Migration 220 — Creative Lab: a 1080 render proxy beside a large original.
--
-- Write only. Not applied from this branch; Matas applies from main.
-- Additive: one nullable column and its index. No DROP.
--
-- A clip whose 9:16 crop would be larger than 1080×1920 (a 4K original)
-- fails on the 2048 MB Lambda: the frame-sheet still and the caption
-- render both stop with a failed fetch from the compositor. The import
-- makes a proxy scaled to 1920 high (1080×1920 for portrait 4K,
-- 3414×1920 for landscape 4K) and stores it as its own creative_assets
-- row. The Lab's renders and the burned-in text check read the proxy;
-- the original stays on creative_asset_id for Drive and download.

alter table creative_lab_clips
  add column if not exists render_asset_id uuid references creative_assets (id) on delete set null;

create index if not exists creative_lab_clips_render_asset_idx on creative_lab_clips (render_asset_id);

comment on column creative_lab_clips.render_asset_id is
  'The 1080 render proxy (a creative_assets row) when the original''s 9:16 crop is larger than 1080×1920. Lab renders and the text check read it; creative_asset_id stays the original for Drive and download. Null when the original is small enough. lib/creative-lab/render-proxy.ts. Migration 220.';
