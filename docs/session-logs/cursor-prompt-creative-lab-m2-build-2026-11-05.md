# Cursor prompt: Creative Lab M2 build, after plan review (2026-11-05)

Rulings on Cursor's M2 review (all accepted unless noted):
- The UGC 1–4 files are already captioned, so they can't be Lab source clips and can't be a caption-over-clip SSIM reference. The style check becomes a mask comparison against a fixed box in the fixture. Matas is sourcing the uncaptioned originals.
- Measured values win over the brief's eyeballed ones (2.4% font size, block ~36% down, medium weight, thin dark edge).
- Text size is defined as % of frame width so it stays the same against the footage in 4:5.
- Output matches the source resolution; never upscale.
- Migration 197 is APPLIED (5 Nov, after the review was written). Migration 198 adds `creative_lab_clips.crop_focus_y`; the 4:5 pairing column waits for M3.
- No `@remotion/fonts`, no `.github` edits, no ffmpeg-overlay fallback in this PR.

```
[Use Opus] BUILD Creative Lab M2 with every finding from your plan-mode review applied. Rulings on your open points:

1. Reference clip: "Luke Dean - UGC 1.mp4" (creative_assets copy), frame at 1.0 s, stays the STYLE reference. The check is your mask comparison: render the caption alone on black at the fixture's exact lines ("Luke Dean joins" / "Enzo Siragusa for" / "our 4th Birthday" / "You in?", no full stop), threshold both at the fixed box stored in reference.json, score SSIM + overlap on the masks. Commit the reference PNG, reference.json (box, lines, timestamp, measurement method). CAPTION_SSIM_MIN starts at 0.85 given the two-Chrome antialiasing difference; record the first measured score in the PR and the session log.
2. Text size: % of frame WIDTH, so 4:5 keeps the caption the same size against the footage. The 4:5 caption sits over the same footage as in 9:16.
3. Output resolution: match the source (UGC 1 → 720×1280; a 1080 source → 1080×1920). Never upscale.
4. Migration 197 is applied in prod. Write 198_creative_lab_crop_focus.sql: `creative_lab_clips.crop_focus_y numeric not null default 0.5 check (between 0 and 1)`; don't apply; add to database.types.ts; update the CLAUDE.md latest-migration line.

5. Uncaptioned originals exist: Drive folder 1uf2yj9K_AT8dZuGe4vLiF1Ni-odFHOth holds four raw mp4s (SnapInsta downloads of Luke Dean's Instagram posts, 5–13 MB, publicly readable: file ids 11tSBYmPapycjmcT5BoCEarKd8s0_YXgz, 14KqCoJzgwXO9NmXRxSAnbKyxHMNuP3PE, 1ejtKx9IhJ_APrtx79HHZEPtJIx1o8Zbd, 1ZOAp04jF0f9yTYk3CqaYeTwrmMDHsQAl). Match each raw to UGC 1–4 by frame (as the tooling thread did for the Ironworks clips), register the raw matching UGC 1 in creative_assets, and use THAT as the render-test source so the test output carries one caption, not two. The captioned UGC 1 remains the style reference only. Record the raw→UGC mapping in the session log.

Branch cursor/creative-lab-m2 off fresh main. Check `gh pr list --search "creative lab"` first. One PR.

=== BUILD (your §6 file list) ===
- src/remotion/caption-style/v1.json measured from the reference frame; profile.ts loads it, hashes it into style_version, holds the layout maths; chars-per-line read from here by lib/creative-lab/caption-facts.ts (remove DEFAULT_CHARS_PER_LINE).
- Fonts: TikTok Sans variable .ttf + OFL.txt under src/remotion/fonts/, imported into the composition (bundler .ttf rule), loaded with FontFace + delayRender/continueRender; `declare module "*.ttf"`. Confirm against the .ttf that the reference's glyphs are TikTok Sans; if they are not, say which font matches and stop before rendering.
- src/remotion/compositions/CaptionOnClip.tsx with calculateMetadata (size + duration from the probed clip), OffthreadVideo on a short-lived signed URL, static caption from frame 0, audio kept ('cleared' treated as 'original'; 'replaced' via <Audio>), 4:5 = centre crop with crop_focus_y, pixel-width check of every line against the safe zone after the font loads, fail on > 4 lines.
- lib/creative-lab/render.ts: one render row per call; probes the clip with getVideoMetadata; renderMedia h264, x264Preset "veryfast", offthreadVideoCacheSizeInBytes 512 MB; uploads via upsertRegisteredAsset / fingerprintBytes; writes creative_assets (sha256, aspect, duration_seconds filled) and the render row (status, render_ms, creative_asset_id, error). Document in the file header that it must only run under /api/admin/remotion/** because of next.config.ts bundling.
- app/api/admin/remotion/render-caption/route.ts mirroring render-reel (FEATURE_REMOTION, maxDuration 600, memory 3008, operator session, not muted).
- components/admin/caption-on-clip-form.tsx on /admin/render-test.
- lib/creative-lab/ssim.ts (pure, pngjs) + scripts/caption-style-check.mts (script only; not wired into CI).
- Tests: layout maths (both aspects, width-relative size, crop focus), SSIM/mask, render.ts with the fake db (status transitions, creative_assets insert, error path).

=== DON'T ===
No Meta/TikTok calls, no launch changes, no lib/learning or lib/meta edits, no next.config.ts or .github edits, no new npm dependencies, no ffmpeg-overlay fallback. Don't register the timing-test output as a creative_assets row.

=== VERIFY ===
npm test, tsc --noEmit and ESLint on touched files, npm run bundle-remotion, npm run build.
Run scripts/caption-style-check.mts and paste the score.
Through the route on the Vercel preview (FEATURE_REMOTION on): render the reference caption on UGC 1 in 9:16 and 4:5; paste render_ms and the creative_assets ids for both. Time one 1080×1920 render on "UGC Clip 1.MOV" (24.7 s) for the feasibility number only; delete that output.
Delete /tmp/cl-m2. State migration 198 is unapplied. Push once. Report SHA, PR, `git log origin/<branch> --oneline -3`. Stop.
```
