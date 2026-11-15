# Cursor prompt: Creative Lab M2, caption render (2026-11-05)

Context: roadmap `docs/session-logs/creative-lab-roadmap-2026-11-05.md` (M2 section, §2 rules 2 and 3), M1 merged as #1077 with migration 197 applied (`creative_lab_renders`, `creative_lab_captions.lines`, `style_version`). Remotion today: `src/remotion/index.tsx` registers `FourTfCityStatic` and `PhotoReelStatic`; `scripts/bundle-remotion.ts` bundles to `.remotion/bundle`; `app/api/admin/remotion/render-reel/route.ts` renders video with `renderMedia` on Vercel at `maxDuration = 600`, 3008 MB, behind `FEATURE_REMOTION`.

Two-step: review first in Plan mode, then build.

```
[Use Opus] REVIEW ONLY first. Do not create a branch or edit files.

Read docs/session-logs/creative-lab-roadmap-2026-11-05.md (M2, §2 rules 2–3), the M1 PR #1077 (lib/creative-lab/, migration 197), src/remotion/index.tsx, the two compositions, scripts/bundle-remotion.ts, app/api/admin/remotion/render-reel/route.ts, lib/creatives/remotion/provider.ts and lib/creatives/types.ts (creative_assets shape, ENABLE_MULTI_PLACEMENT_ASSETS aspect handling in lib/meta/creative.ts).

The M2 spec to review:

=== GOAL ===
Burn a validated caption into an artist clip so the result is indistinguishable from native TikTok/Reels text. One locked style, versioned, checked against a reference frame. Outputs 9:16 and 4:5 as creative_assets rows and creative_lab_renders rows.

=== STYLE PROFILE ===
src/remotion/caption-style/v1.json (versioned by content hash = style_version): font family + weight, font size as % of frame height, fill #FFFFFF, stroke colour #000000 and width as % of font size, line height, chars per line (18), text block vertical centre as % of frame height, horizontal centre, safe-zone insets per aspect. Values are MEASURED from the designated reference clip (Matas names it; until then use "Luke Dean - UGC 1.mp4", Drive 1VNEtRgELOYEOPXE5gOKtHJEEfy6TejD9, frame at 1.0 s) and recorded with the measurement method in the file header. TikTok Sans from Google Fonts, the .ttf files committed under src/remotion/fonts/ with the OFL licence file, loaded with @remotion/fonts or @font-face in the bundle; never a CDN at render time.

=== COMPOSITION ===
src/remotion/compositions/CaptionOnClip.tsx: props { clipUrl, lines: string[], styleVersion, aspect: '9:16'|'4:5', inS?, outS?, audio: 'original'|'muted'|'replaced', replacementAudioUrl? }. Video via <OffthreadVideo>. Caption static from frame 0, no animation. 4:5 crops the 9:16 source centre and re-positions the block per the profile's 4:5 safe zone; the text size (as % of height) does not change. Fail the render if lines.length > 4 or any line exceeds charsPerLine (the validator already enforces it; the composition re-checks).

=== RENDER PATH ===
lib/creative-lab/render.ts: renderCaptionOnClip({ renderId }) reads creative_lab_renders → clip (creative_assets storage path) + caption (lines, style_version) → renderMedia h264 → upload to campaign-assets → insert creative_assets (sha256, aspect, duration) → update the render row (status, render_ms, creative_asset_id). Runs through a new route app/api/admin/remotion/render-caption/route.ts mirroring render-reel (FEATURE_REMOTION, maxDuration 600, memory 3008, operator session). Measure and log render_ms for a 30 s 1080×1920 clip. If it exceeds 500 s or OOMs, stop and report; do not add Lambda in this PR.

=== REFERENCE-FRAME CHECK ===
scripts/caption-style-check.mts: renders the reference caption ("Luke Dean joins Enzo Siragusa for our 4th Birthday. You in?", lines as the validator wraps them) over the reference clip at the reference timestamp, extracts that frame and the original frame, computes SSIM over the caption bounding box (use a pure-JS SSIM; no native deps). Prints the score; exits non-zero under CAPTION_SSIM_MIN (start at 0.90, tune after the first measurement). Wire it into CI only if it runs under 90 s on the runner; otherwise leave it as a script and say so. The reference frame PNG is committed as a fixture.

=== DON'T ===
No Meta/TikTok calls. No launch changes. No UI beyond the admin render-test page getting a "Caption on clip" form (like render-reel-form.tsx). No changes to lib/learning or lib/meta.

Report, in this order:
1. Anything above that contradicts how Remotion is set up in this repo (bundling, fonts, OffthreadVideo on Vercel, where compositions register).
2. Whether 4:5 should be a crop of the 9:16 or a separate render from a 4:5 source when one exists in creative_assets, and how ENABLE_MULTI_PLACEMENT_ASSETS expects the pair.
3. Font loading in the SSR bundle: the working approach in this repo's Remotion version.
4. Whether the caption bounding box for SSIM should come from the profile (deterministic) or OCR; recommend one.
5. Vercel feasibility: your estimate of render_ms for a 30 s clip on the render-reel route, and the first thing that would break.
6. Size and files.
Then stop.
```

After the review is agreed, the build prompt is the same spec with "BUILD" at the top, branch `cursor/creative-lab-m2` off fresh main, one PR, and this VERIFY: npm test, tsc --noEmit and ESLint on touched files, npm run bundle-remotion, npm run build; run scripts/caption-style-check.mts and paste the SSIM; render the reference caption on UGC 1 in both aspects through the route and paste render_ms and the creative_assets ids; commit the reference frame fixture; push once; report SHA, PR, `git log origin/<branch> --oneline -3`; stop.
