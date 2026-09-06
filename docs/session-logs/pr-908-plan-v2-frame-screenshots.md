# Session log

## PR

- **Number:** 908
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/908
- **Branch:** `cursor/plan-v2-frame-screenshots`

## Summary

Screenshot harness for the 33 canon frames plus `J0 · loading`. Each fixture is view-function input, no database. Playwright diffs `docs/frames/<id>.png` at 0.2%. The first honest render is the baseline; differences versus the canvas are listed on the PR, not hidden.

## Scope / files

- `scripts/plan-frames/` — ids, fixtures, capture/check runner
- `app/(dev)/frames/[id]` — gated by `ENABLE_PLAN_FRAMES` (off on Vercel prod)
- `components/plan/plan-frame-mount.tsx` — mounts the real list / launch / adjust / learn surfaces
- `docs/frames/` — committed baselines
- CI `frames:check` job after build

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5338 pass, 4 skipped)
- [x] `npm run frames` (36 baselines)

## Notes

Do not merge until the frame-diff list has been walked. Mac baselines may rasterise differently from Ubuntu CI — if `frames:check` fails only on antialiasing, regenerate on the CI image.
