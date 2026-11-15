# Cursor prompt: Creative Lab M2c, 9:16-only video with a 4:5 safe rectangle (2026-11-05)

Matas's rule (roadmap M6 "Output sizes"): all video assets are 9:16 only; key information sits inside the centred 4:5 rectangle so one file crops to Feed/Stories/Reels. Statics are 1:1, 4:5 and 9:16. This replaces M2's separate 4:5 video render.

```
[Use Opus] BUILD Creative Lab M2c: 9:16-only video with a 4:5 safe rectangle. Read the "Output sizes" block in docs/session-logs/creative-lab-roadmap-2026-11-05.md first.

Branch cursor/creative-lab-m2c-916 off fresh main (after #1079). One PR.

=== CHANGES ===
1. CaptionOnClip renders 9:16 only. Remove the 4:5 output path. The style profile v1.json gains `safeRect` for 9:16: the centred 4:5 rectangle (x 0, y 0.1458, w 1, h 0.7083 of the frame; 1080×1350 inside 1080×1920). The caption block must lie entirely inside it; the composition fails the render if any line's measured box leaves it. crop_focus_y now means the vertical centre of that safe rectangle (default 0.5 = centred); keep the column, update its comment via migration 199 (comment only, no schema change; write, don't apply).
2. creative_lab_renders.aspect: keep the column and CHECK, but the Lab writes only '9:16' for video. Add a `kind` column via the same migration 199: CHECK (kind in ('video','static')), default 'video'. Statics (M6) will write 1:1, 4:5 and 9:16 rows with kind='static'; nothing writes them yet.
3. The style check and side-by-side stay on the 9:16; the fixture's reference.json records safeRect and the check asserts the reference caption sits inside it (it does: the block centre is ~36% down).
4. lib/creative-lab/render.ts: drop the 4:5 branch; one Lambda render per caption. Mark the existing 4:5 render row f5a53cc7-85fe-4660-82e5-5d18f1e5611b and its creative_assets row 71210f71-93fb-415f-9a20-75fdb943e34d as superseded (render status 'failed' with error 'superseded: 9:16 only', asset left in place).
5. Update the roadmap's M2 bullet about aspects to point at M6 "Output sizes", and CLAUDE.md's latest-migration line.
6. Tests: a caption block that crosses the safe rectangle fails; one inside passes; crop_focus_y 0.3 moves the rectangle up and the caption with it; aspect '4:5' with kind 'video' is rejected by the loader.

=== DON'T ===
No change to the Lambda path, fonts or the measured style values. No static rendering yet.

=== VERIFY ===
npm test, tsc --noEmit and ESLint on touched files, npm run build. Render the reference caption on the raw UGC 1 once through the preview route and paste render_ms and the creative_assets id. Push once. Report SHA, PR, `git log origin/<branch> --oneline -3`. Stop.
```
