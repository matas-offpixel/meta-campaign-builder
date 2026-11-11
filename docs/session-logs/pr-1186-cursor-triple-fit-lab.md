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
- `lib/creative-lab/triple-fit-render.ts` — seam Claude Code replaces; no single-clip crop
- `lib/plan/creative-intake.ts`, `preflight.ts`, `mml-creative-intake.tsx` — plan rows stay and do not launch
- Frames rebaselined from the Ubuntu `plan-frames` artifact: CL3, CL4, CL5, CL6, CL9, CL10 at 1280 and 393; CL11-1280 and CL11-393 added; IR1-1280 and IR2-1280. IR2-393 did not move.

## Validation

- [x] Unit tests for classification, import, offer, one-per-source, round, render seam, plan hold
- [x] `npm run build` — CI run 43023326237 (worktree `node_modules` is a symlink)
- [x] Frame baselines from that run's Ubuntu `plan-frames` artifact, `shots/` matched `diff/*/actual.png`

## Notes

Migration sha256: `4764328685590c3aab34267e1b5bcbccb6b3cf27a3cb263cb5e96388907c31ac`

`t1-video.ts` and `t1-video-frame.ts` are unchanged by this branch. `footageWindow` is read-only. Luke's existing rows change line by classification; nothing is written to them. The design-pass check is red because frames changed and the label was not added.

Main (`8da4fa5`) is merged in. #1187's rules stay in `lib/creative-lab/triple-fit.ts`; the Lab's row write moved to `make-triple-fit.ts` so the two files do not share a name. Migration 229's sha256 is unchanged. The made tile still does not call `TripleFitOnClip`: #1187 exposes the composition and the pure rules, and the only launcher is `scripts/triple-fit-drafts.mts`. There is no Lab hook that builds the T1 B layers and renders composition `TripleFitOnClip`.
