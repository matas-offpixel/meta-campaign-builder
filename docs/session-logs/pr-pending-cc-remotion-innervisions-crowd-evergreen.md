# Session log — Innervisions evergreen crowd-shot reel

## PR

- **Number:** pending
- **URL:** (pending)
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
- [ ] `/api/admin/remotion/render-reel?reel=innervisions-crowd` — signed URL on Vercel Preview
- [ ] MP4 — 43 photos, ~11.5s, <30MB, no black frames

## Notes

- Local `npm run dev` / `next start` blocked by pre-existing dynamic route slug conflict (`clientId` vs `id`); render verification runs on Vercel Preview with `FEATURE_REMOTION=1`.
- Audio not baked; sync in CapCut post-render (~120 BPM target).
