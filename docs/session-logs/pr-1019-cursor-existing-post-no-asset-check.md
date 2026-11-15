# Session log

## PR

- **Number:** 1019
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1019
- **Branch:** `cursor/existing-post-no-asset-check`

## Summary

An imported existing post was failing the creatives step because dual-mode asset slots were still required. A boosted post has no slots: validation skips them, and the importer no longer copies `asset_feed_spec` ratios onto that creative.

## Scope / files

- `lib/validation.ts` — existing posts skip asset completeness and the upload-slot loop
- `lib/meta/import/map.ts` — existing posts stay single and record the dropped feed
- `lib/meta/import/creative-copy.ts` — placement images on a boosted post are not an app-built spec
- `lib/meta/creative.ts` — unchanged; a test locks the existing-post payload

## Validation

- [x] `npm run build`
- [x] `npm test` (6644 pass, 4 skipped, vitest 6 pass)

## Notes

Creatives is `validateStep(4)`. The Media Type / Asset Mode / Asset Variations block already renders only for `sourceType === "new"`, including imported drafts, which use the same creatives step. `buildExistingPostCreative` does not read `assetVariations`.
