# Session log template

## PR

- **Number:** 970
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/970
- **Branch:** `cursor/meta-import-map`

## Summary

Meta import PR B reads a live campaign, maps it onto a `CampaignDraft`, and saves only when the operator ticks creatives and attaches an event. The importer still writes nothing to Meta. Geo uses the location-group model from #967, built from Meta's city keys, and every imported location stays untiered.

## Scope / files

- `lib/meta/import/map.ts`, `picker.ts`, `save.ts`, `event.ts`
- `app/api/meta/campaigns/import/route.ts`
- `CampaignDraft.importMeta` preserved by `migrateDraft`
- Tests replay the committed Ironworks capture `52522388611107`

## Validation

- [x] `npm test` (6174 pass, 4 skipped)
- [x] `npm run build`

## Notes

The two ad sets with no cities are `Jamie Jones – Adv+ EU` (IT, ES, PT, FR, DE) and `Jamie Jones – Adv+ UK` (GB). They import as country groups. A copied ad set with empty `geo_locations` is the row `validateStep` names. `flexible_spec` is absent on 30 ad sets and present on 3; none are empty. No location-search call.
