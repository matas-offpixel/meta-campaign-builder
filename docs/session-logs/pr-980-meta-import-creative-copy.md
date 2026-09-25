# Session log

## PR

- **Number:** 980
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/980
- **Branch:** `cursor/meta-import-creative-copy`

## Summary

Imported creatives were taking caption, headline, URL and CTA from `extractPreview`, which reads `object_story_spec` and falls back to the creative name. Campaigns this app launched store that copy on `asset_feed_spec`. The importer now reads there first, keeps every body as a caption, and never uses the creative name as the headline. A Feed + Story pair comes back as Dual (`4:5` and `9:16`) from the placement labels.

## Scope / files

- `lib/meta/import/creative-copy.ts` — importer-owned copy and asset-mode read
- `lib/meta/import/map.ts` — uses it; `extractPreview` stays on the dashboard path
- `lib/meta/import/save.ts` — one batched `/adimages` size read for images with no placement label
- Creatives step — a row note when the source had no headline

## Validation

- [x] `npm test` — 6288 pass, 3 skipped
- [x] `npm run build`
- [ ] check runs (reported in the thread, not in this file)

## Notes

DHB `object_story_spec` has no `link_data`. `titles` is absent on all 25 creatives, so the headline stays empty and the row says so. Ironworks still imports through `link_data` / `video_data`. The importer writes nothing to Meta.
