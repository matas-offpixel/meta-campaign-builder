# Session log

## PR

- **Number:** 1186
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1186
- **Branch:** `cursor/triple-fit-lab`

## Summary

A landscape clip whose own 9:16 is under 675 px, and whose part window is not, is imported and labelled "Landscape — triple-fit only". It stays out of a single-clip round. "Make a triple-fit" writes one new clip per source when that owner has fewer than three clips that can run in 9:16. The made clip joins a round as a 9:16; the three-part picture is left for `cc/triple-fit`. An MML row that cannot make 9:16, and a 4:5 or 1:1 video row, stay on the plan and cannot launch.

## Scope / files

- `lib/creative-lab/import-quality.ts` — part window, import, plan-row lines
- `lib/creative-lab/surface.ts`, `selection.ts`, `clips.tsx` — tile, group, offer
- `lib/creative-lab/triple-fit.ts`, migration `229_creative_lab_clips_triple_fit.sql` — one made clip per source (written, not applied)
- `lib/creative-lab/triple-fit-render.ts` — a made clip renders as TripleFitOnClip from the source clip's render copy
- `lib/plan/creative-intake.ts`, `preflight.ts`, `mml-creative-intake.tsx` — plan rows stay and do not launch
- Frames rebaselined from the Ubuntu `plan-frames` artifact: CL3, CL4, CL5, CL6, CL9, CL10 at 1280 and 393; CL11-1280 and CL11-393 added; IR1-1280 and IR2-1280. IR2-393 did not move.

## Validation

- [x] Unit tests for classification, import, offer, one-per-source, round, render seam, plan hold
- [x] `npm run build` — CI run 43023326237 (worktree `node_modules` is a symlink)
- [x] Frame baselines from that run's Ubuntu `plan-frames` artifact, `shots/` matched `diff/*/actual.png`

## Notes

Migration sha256: `4764328685590c3aab34267e1b5bcbccb6b3cf27a3cb263cb5e96388907c31ac`

`t1-video.ts` and `t1-video-frame.ts` are unchanged by this branch. `footageWindow` is read-only. Luke's existing rows change line by classification; nothing is written to them. The design-pass check is red because frames changed and the label was not added.

Main (`9d38cec`, #1188) is merged in. #1187's rules stay in `lib/creative-lab/triple-fit.ts` and are imported, not copied. The Lab's row write stays in `make-triple-fit.ts`. A made clip renders through `renderTripleFitClip` only from `renderMadeTripleFit`: T1 arrangement B, composition `TripleFitOnClip`, the source clip's render copy. Caption rounds refuse it with "T1 only — not paired with captions". The claim is the event's approved ladder claim, or none. The clip carries the event kit's lockup (the logo layer's ink, placed at y 353) and the kit's date piece, whose label is "SUNDAY 27TH DECEMBER". Made clips are their own group, "Triple-fit", so they are not counted under New. A landscape source is not also "Too small for 9:16", so its tile is muted ink and a plain hairline. Migration 229's sha256 is unchanged. CL11-1280 is rebaselined from this round's Ubuntu shot even when the diff is inside tolerance. CL12 is the frame where the made tile is fully visible at 393.
