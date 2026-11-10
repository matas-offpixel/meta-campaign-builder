# Session log

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/clip-render-copy`
- **Base:** `8daf45674736b21164ed1367d7e772e6245f5765` (main)

## Summary

Instagram import was still refusing a reel on the old crop line. Video import now follows O63: a reel imports when its narrowest crop window is at least 675 px wide, and a narrower one is refused with O63's line. A source over 1080 keeps its original and stores the existing 1080 render copy at CRF 16. Folder and press-kit clips are listed before Instagram clips in an artist's group.

## Scope / files

- `lib/creative-lab/ig-import.ts` — O63 gate; render copy on an oversized import; the original is not re-encoded
- `lib/creative-lab/render-proxy.ts` — CRF 16
- `lib/creative-lab/t1-video.ts` — `importQualityLine`
- `components/dashboard/events/creative-lab/clips.tsx` — folder and press-kit clips first
- `scripts/reset-puzzle-candidate.mts` — dry run, then `--apply`, for media `17965611758980656` only
- `scripts/backfill-render-copies.mts` — dry run, then `--apply`, for Puzzle's Luke 4 and Luke 5

## Validation

- [x] `node --test` for the import, the proxy args, and the resolution rules
- [x] Dry run: 1 skipped Puzzle candidate would return to candidate. Not applied.
- [x] Dry run: Luke 4 and Luke 5 already have an 1080 proxy. 0 to write.
- [ ] `npm run build` (CI)

## Notes

No migration. The render copy is the existing `creative_lab_clips.render_asset_id` (migration 220). Lambda already reads it. A landscape 4K copy is 3414 × 1920 rather than 3413, so the width stays even for H.264; the 9:16 window is still 1080. Stills are unchanged and still never upscale.
