# Creative Lab M2: caption on a clip

## PR

- **Number:** 1078
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1078
- **Branch:** `cursor/creative-lab-m2`

## Summary

Creative Lab M2 burns one static caption onto one clip through the existing Remotion route and registers the mp4. The style is measured from the caption already on "Luke Dean - UGC 1.mp4" and locked in `src/remotion/caption-style/v1.json`. The render-test source is the uncaptioned Instagram original that matches that clip, so the output carries one caption. Text size is a percentage of frame width. A portrait source keeps its width; a landscape original is centre-cropped to 9:16 at the source height and never upscaled. 4:5 is a vertical crop of that window (`crop_focus_y`).

**Migration 198 is unapplied.** Matas applies. It adds `creative_lab_clips.crop_focus_y`.

## Raw → UGC

Drive folder `1uf2yj9K_AT8dZuGe4vLiF1Ni-odFHOth`. Each raw was aligned to the captioned UGC file by audio cross-correlation, then checked by a caption-masked frame difference at that offset. A match scores about 2–10 (mean absolute error, 0–255). A wrong pair scores about 40–58.

| Raw (Drive file) | Picture | Matches | Frame MAE | Audio lag |
|---|---|---|---|---|
| `14KqCoJzgwXO9NmXRxSAnbKyxHMNuP3PE` | 956×718, 34.06s | Luke Dean - UGC 1 | 5.3 | 14.17s |
| `11tSBYmPapycjmcT5BoCEarKd8s0_YXgz` | 1080×720, 52.80s | Luke Dean - UGC 2 | 10.1 | 19.77s |
| `1ejtKx9IhJ_APrtx79HHZEPtJIx1o8Zbd` | 960×720, 25.45s | Luke Dean - UGC 3 | 6.3 | 2.47s |
| `1ZOAp04jF0f9yTYk3CqaYeTwrmMDHsQAl` | 720×1280, 34.46s | Luke Dean - UGC 4 | 1.7 | 6.77s |

The UGC 1 original is registered as `creative_assets` `310a135b-a743-436a-8715-62a02bf5d59a`, filename `Luke Dean - UGC 1 raw.mp4`, `videos/1b743190-4632-447e-98b8-07da6868d5c0.mp4`, sha256 `29ad638f75cf352b89ec5daef7ddaa2a286c4b24f3f044f160f5133f9d3b3fad`, 6,524,203 bytes, aspect `other`, duration 34.06s. The captioned UGC 1 (`55f1f424-99e7-4c3c-956f-325f9e053f08`) stays the style reference only.

The 9:16 window of that raw is a centre crop, 402×718. The best-matching window starts 7px to the right of centre (focus 0.508). The render uses the centre. 4:5 of the same window is 402×502.

## Reference-frame check

`scripts/caption-style-check.mts` renders the four lines on black and scores the masks inside the box in `reference/reference.json`. Not wired into CI.

Locked profile: TikTok Sans, weight 500, `wdth` 120, 5.1389% of frame width, stroke 0.027em painted over the fill. `style_version` `df52833b2b1f231543b35012cf293b2cc18e9fd8c5b48aa8f8ae7842ae2cbd22`.

First score of that locked profile against the captioned UGC 1 mask, Remotion's Chrome: **SSIM 0.5784**, dice 0.5505, iou 0.3798. A width/weight/size/stroke search peaked here. The cores overlap; the 720p reference mask is a thinner, slightly different drawing of the same letters (the "4" in particular). That 0.5784 is the recorded score against the original reference.

`docs/creative-lab/ugc1-side-by-side.png` is the captioned UGC 1 frame at 1.0s beside a local Remotion still of the raw at 15.17s (the same moment; audio lag 14.17s). Both panels are the centre 9:16 crop shown at 720×1280. The still itself is 402×718, scale 1, and is scaled up only in that image. Footage outside the caption box differs by MAE 11.0, and the best horizontal shift is 1px. Approval of that image is pending. Until then the script prints the score and exits 0. Once the image is approved, the fixture becomes our render's caption mask and `CAPTION_SSIM_MIN` is 0.95.

## Scope / files

- `src/remotion/caption-style/v1.json`, `profile.ts`, `reference/`: measured style, layout maths, the reference frame and box.
- `src/remotion/fonts/`: TikTok Sans variable font and its OFL.
- `src/remotion/compositions/CaptionOnClip.tsx`, registered in `src/remotion/index.tsx`.
- `lib/creative-lab/render.ts`: one render row per call. Runs only under `/api/admin/remotion/**`.
- `app/api/admin/remotion/render-caption/route.ts`: `FEATURE_REMOTION`, 600s, 3 GB, operator session. A `timing` body renders and discards the file.
- `components/admin/caption-on-clip-form.tsx` on `/admin/render-test`.
- `lib/creative-lab/ssim.ts`, `scripts/caption-style-check.mts`.
- `docs/creative-lab/ugc1-side-by-side.png`. Pending approval.
- `lib/creative-lab/caption-facts.ts`: chars per line come from the profile.
- `supabase/migrations/198_creative_lab_crop_focus.sql`. Unapplied.
- `lib/db/database.types.ts`, `CLAUDE.md` latest-migration line.

## Validation

- [x] `npm test` — 7523 tests, 7519 pass, 0 fail (4 skipped), plus the creative-lab tests after the landscape crop (69 pass)
- [x] `npx tsc --noEmit` — no errors in the files this PR touches. The tree still has existing errors elsewhere.
- [x] ESLint on the touched files
- [x] `npm run build`
- [x] `npm run bundle-remotion` and `scripts/caption-style-check.mts` (SSIM 0.5784)
- [x] Preview reached READY. The render did not. Node 26.x (`engines` `>=22`, which overrides the project setting of 24.x) and Node 22.x (`engines` `22.x`, deployment `dpl_2nTmtTsW3q4EH4v5mReHXKe715mP`) both fail the compositor: `libm.so.6: version GLIBC_2.35 not found`. 24.x did not run. No Lambda. The `22.x` engines pin was reverted and not committed.
- [ ] The 1080p timing sample. Not run. The same compositor blocks it on Vercel.

## Notes

The Vercel function image lacks glibc 2.35 for `@remotion/compositor-linux-x64-gnu`. The render path moves to Remotion Lambda in M2b. `next.config.ts` is unchanged.

Render-test rows, owned by the same user as the UGC assets. Both renders are `failed` with the compositor error. The 9:16 row's `render_ms` is 1436, the time to fail, and it has no creative asset. The 4:5 row was not sent, because it hits the same binary.

- artist `fe3736d8-4252-4282-bb32-de1e3fdfb359` (Luke Dean, Puzzle). No `approved_at`, so no round can be built.
- clip `5604f7f6-b3ae-4825-9f3c-e98c2fd38ef6` → the raw asset
- caption `f3d8c8c6-4bb1-4576-9e97-b93285932271`
- 9:16 render `db1957ff-61ca-4298-b8c7-e7e799a1baa1` — failed
- 4:5 render `f5a53cc7-85fe-4660-82e5-5d18f1e5611b` — failed
