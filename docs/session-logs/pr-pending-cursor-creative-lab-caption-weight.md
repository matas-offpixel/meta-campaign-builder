# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creative-lab-caption-weight`

## Summary

The 2px outline stayed. The letters were heavier than the reference because the wght axis was 500. At 720 wide, with that outline and wdth 120, the half-max white core of the l in Luke is 3.78px on the reference and 4.94px / 4.19px / 3.95px at weights 500 / 450 / 400. The i is 3.80px on the reference and 4.90px / 4.20px / 3.97px. Weight 400 is the match. wdth 100 / 120 / 140 at weight 400 measure 3.86px / 3.97px / 4.03px, so the width axis stays 120.

## Scope / files

- `src/remotion/caption-style/v1.json` `fontWeight` 400. `style_version` `89d248eccb90ce66fe8cfcdc90b2f0dcc18428e90eddcfa3a3149306d61f3aaa`.
- `docs/creative-lab/ugc1-side-by-side.png` regenerated (UGC 1 at 1.0s beside the raw at 15.17s).
- `src/remotion/caption-style/reference/caption-mask.png` re-baselined to this render. `CAPTION_SSIM_MIN` stays 0.95.

## Validation

- [x] Drift guard against `caption-mask.png`: SSIM 1.0000, dice 1.0000, iou 1.0000.
- [x] `npm test` — 7534 tests, 7530 pass, 0 fail, 4 skipped; vitest 8 pass.
- [x] `tsc` on the touched files, ESLint on the touched files, `npm run build`.
- [ ] Preview render of the raw UGC 1. Recorded on the PR after the one push.

## Notes

Stem widths are the half-max of the white core, measured on the straight part of the letter with the 2px outside stroke in place. The Remotion still of the l at weight 400 measured 3.96px, the same as the Chrome measurement. A caption render on production fails the style check until this PR is merged, because that deployment still hashes the previous profile.
