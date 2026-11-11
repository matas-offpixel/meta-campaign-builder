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
- Frames: CL11 added. CL3, CL4, CL5, CL6, CL9, CL10 and the IR shots that mount them will move because Bea Lowe #1 is now triple-fit only. Ubuntu rasters land after CI.

## Validation

- [x] Unit tests for classification, import, offer, one-per-source, round, render seam, plan hold
- [ ] `npm run build` — CI is the build gate (worktree `node_modules` is a symlink)
- [ ] Frame baselines — after the Ubuntu `plan-frames` artifact

## Notes

Migration sha256: `4764328685590c3aab34267e1b5bcbccb6b3cf27a3cb263cb5e96388907c31ac`

`t1-video.ts` and `t1-video-frame.ts` are unchanged. `footageWindow` is read-only. Luke's existing rows change line by classification; nothing is written to them. The design-pass check will be red because frames change and the label is not added.
