# Session log — Junction 2 Bridge reel composition (Remotion)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `creative/junction2-bridge-reel-composition`

## Summary

Adds the first video composition to the Remotion pipeline: a 14.93s (448-frame @ 30fps) photo reel for Junction 2 Melodic 2026-07-26 using 64 photos from the 2025 Bridge stage shot by Khroma Collective. Introduces the generic `PhotoReelStatic` composition (1080×1920 h264 MP4, hard cuts, Ken Burns zoom), an admin render route, an admin UI page, a one-shot upload script, and unit tests — all behind the existing `FEATURE_REMOTION` flag.

## Scope / files

- `src/remotion/compositions/PhotoReelStatic.tsx` — new generic photo-reel composition
- `src/remotion/index.tsx` — extended: `PhotoReelStatic` registered alongside `FourTfCityStatic`, with `calculateMetadata` for dynamic `durationInFrames`
- `scripts/upload-reel-photos.ts` — one-shot sharp-resize + Supabase Storage upload script; writes `scratch/j2-bridge-render-input.json`
- `app/api/admin/remotion/render-reel/route.ts` — POST route (maxDuration 600s, memory 3 GB); reads render-input JSON, calls `renderMedia` h264, uploads MP4, returns 7-day signed URL
- `app/admin/render-reel/page.tsx` — auth-gated server component
- `components/admin/render-reel-form.tsx` — client component with spinner, video embed, download link
- `lib/creatives/remotion/__tests__/photo-reel.test.ts` — unit tests for props shape, duration calculation (64×7=448), empty-array safety, zero-frame clamp
- `package.json` — added `sharp@0.34.5` and `tsx@4.22.4` as devDependencies

## Validation

- [ ] `npm run lint` — clean on touched files
- [ ] `npm test -- photo-reel` — all 5 unit tests pass
- [ ] `npm run build` — exit 0 (requires `npm run bundle-remotion` first)
- [ ] Matas runs `npx tsx scripts/upload-reel-photos.ts` locally; `scratch/j2-bridge-render-input.json` exists with 64 public Supabase Storage URLs
- [ ] Matas hits `/admin/render-reel` on Vercel Preview with `FEATURE_REMOTION=1` — MP4 renders, plays in browser
- [ ] MP4 is 5–15 MB, plays cleanly with no frame-skip glitches

## Notes

- `lib/creatives/remotion/provider.ts` (still-render path) untouched — this PR rides alongside it.
- `src/remotion/index.tsx` extended with `calculateMetadata` so `durationInFrames` is dynamic per `inputProps.photos.length`.
- `renderMedia` uses `muted: true` — no audio encoded. Matas syncs "Ghosts" (Miss Monique / Nicolas Taboada / FRANCO BA, Siona Records) in CapCut post-render.
- `FEATURE_REMOTION` stays at 0 in Production. Flip is a separate decision after Preview smoke (open task #25 from handover).
- Render time, MP4 size, and Ken Burns subjectivity (enough motion vs strobe) to be captured after Matas's first Preview run — fill in below.

### Post-render observations (fill in after acceptance)

- Render time (cold start): TBD
- Render time (warm): TBD
- MP4 file size: TBD
- Bitrate: TBD
- Ken Burns verdict: TBD
- Memory pressure in Vercel logs: TBD
