# Session log — Innervisions evergreen crowd-shot reel

## PR

- **Number:** 597
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/597
- **Branch:** `cc/remotion-innervisions-crowd-evergreen`

## Summary

Adds `FRAMES_PER_PHOTO_OVERRIDE` to `scripts/upload-reel-photos.ts` (validated 1–60) and ships the Innervisions evergreen crowd reel: 43 J2 Robin Lee portraits @ 8 frames/photo, 30fps (~11.47s). Photos uploaded to Supabase Storage; manifest + render-input committed under `scratch/`. Source JPEGs stay local (`Crowd photos/` gitignored).

## Scope / files

- `scripts/upload-reel-photos.ts` — env override + JSDoc
- `scratch/j2-innervisions-crowd-manifest.json` — reel metadata, 43-photo manifest
- `scratch/j2-innervisions-crowd-render-input.json` — PhotoReelStatic input (43 URLs, framesPerPhoto 8)
- `.gitignore` — ignore `Crowd photos/`

## Validation

- [x] `npm run build` — exit 0
- [x] Upload script — 43 photos in Supabase `campaign-assets/reel-photos/innervisions-crowd/`
- [x] `render-input.json` — framesPerPhoto 8, 43 photo URLs
- [x] `/api/admin/remotion/render-reel?reel=innervisions-crowd` — 200 on Vercel Preview (96.8s render)
- [x] MP4 — 11.47s, 4.1 MB (4343368 bytes), signed URL returned

### Post-render observations

- Render time (Preview): 96.8s
- MP4 file size: 4.1 MB
- Duration: 11.47s (344 frames @ 30fps = 43 × 8)
- Local download: `~/Downloads/innervisions-crowd-evergreen-2026-06-12T15-03-51.mp4`
- Storage path: `remotion-renders/.../innervisions-crowd-ad5dc097-8e3d-4260-a5f0-7a1b17e973da.mp4`

## Notes

- Local `npm run dev` / `next start` blocked by pre-existing dynamic route slug conflict (`clientId` vs `id`); render verification runs on Vercel Preview with `FEATURE_REMOTION=1`.
- Audio not baked; sync in CapCut post-render (~120 BPM target).
