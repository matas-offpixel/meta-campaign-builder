# Session log

## PR

- **Number:** 608
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/608
- **Branch:** `cursor/asset-completeness-validation-gate`

## Summary

Adds a validation gate that blocks Dual/Full-mode ad creatives from proceeding
to launch (or step continuation) when any asset variation is missing one or
more required aspect-ratio slots. Closes the latent kickoffclubfanzones-shape
gap: without this gate, a dual-mode creative with only a 9:16 uploaded would
silently fall through to legacy single-asset cross-publishing, causing the 9:16
to appear cropped in Feed placements.

## Scope / files

- `lib/validation/asset-completeness.ts` — new validator (`validateCreativeAssetCompleteness`, `validateAllCreativesAssetCompleteness`, `formatAssetCompletenessIssues`)
- `lib/validation/__tests__/asset-completeness.test.ts` — 12 unit tests (single/dual/full, image/video, multi-variation)
- `lib/validation.ts` — `validateCreatives()` now calls the completeness check for step 4 `canContinue`
- `components/steps/creatives.tsx` — `AssetVariationCard` gains `assetMode` prop + inline amber warning when ratios are missing
- `app/(dashboard)/clients/[id]/bulk-attach/wizard.tsx` — "Review & launch" button and "Launch" button both gate on completeness; amber/red banners when incomplete
- `docs/audits/asset-completeness-audit-2026-06-18.md` — historical audit showing all 14-day published dual/full drafts are clean

## Validation

- [x] `npm test` — 12/12 passing (`lib/validation/__tests__/asset-completeness.test.ts`)
- [x] `npm run build` — passes, no type errors

## Notes

Audit found no incomplete dual/full-mode launches in the last 14 or 60 days —
this gate is non-disruptive to any live ads. The `single` mode short-circuit
in the validator ensures no false positives for operators who explicitly chose
one aspect ratio.
