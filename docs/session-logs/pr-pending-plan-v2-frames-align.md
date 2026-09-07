# Session log

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/plan-v2-frames-align`

## Summary

Align the #908 fixtures to the ratified third canvas (v3 + third-issue brief §3–§4) and fix the two face defects the diff list exposed. Ubuntu baselines regenerated after the fixture/face change.

## Scope / files

- `scripts/plan-frames/fixtures.ts` · `builders.ts` — ratified A2/J3/J5/J7/J8/J1/L3 numbers and dates
- `lib/plan/learn-face.ts` · `plan-workspace.tsx` · `plan-frame-mount.tsx` — LEARN reads launch-phase unit
- `components/plan/canvas-adjust.tsx` — no `£—` chip beside a real purchase line
- `lib/plan/{adjust,launch,learn}-face.ts` — `formatGbp` keeps two decimals
- `components/library/plan-library.tsx` · frames page · `run.mjs` — no harness title; list chrome cropped

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `frames:check` on Ubuntu CI

## Notes

`frames:check` is the CI truth. Remaining render-vs-v3 differences are in the PR body — next round, not hidden.
