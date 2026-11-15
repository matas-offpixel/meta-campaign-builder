# Session log

## PR

- **Number:** 1009
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1009
- **Branch:** `cursor/creative-name-follows-file`

## Summary

A creative name stays put only when the operator typed it in the Ad Name field. Duplicated, template-loaded, and Add-to-campaign names are replaced by the first uploaded file. Drafts already saved without the flag keep a custom name.

## Scope / files

- `lib/types.ts` — `AdCreativeDraft.nameSource`
- `lib/creative-name-from-filename.ts` — rename unless `operator` or `file`
- `lib/autosave.ts` — fill a missing flag on load
- `components/steps/creatives.tsx` — Ad Name sets `operator`; duplicate copies the source flag
- `lib/templates.ts`, `lib/library/add-to-campaign.ts` — copied names stay replaceable

## Validation

- [x] `npm test`
- [x] `npm run build`

## Notes

Existing drafts with a non-empty name other than `Ad N` and no flag load as `operator`, so ads already live are not renamed. A second file does not rename a creative already marked `file`.
