# Session log — audience source date_preset + cache

## PR

- **Number:** 310
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/310
- **Branch:** `creator/audience-source-spend-and-pages-fix`

## Summary

Fixes a production `(#100) lifetime is not a valid date_preset` error from campaign field expansion (regression vs PR #308) by using `insights.date_preset(last_year){spend}`. Tightens audience source HTTP cache to only store non-empty successful payloads so empty or error states are not replayed for 30 minutes. Confirms `fetchAudiencePageSources` is independent of the campaigns fetch in `lib/audiences/sources.ts`. Updates video campaign picker copy to “last 12 months spend”.

## Scope / files

- `lib/audiences/sources.ts` — `last_year` preset; short API note
- `lib/audiences/source-cache.ts` — `audienceSourcePayloadIsCacheable`, skip cache for empty arrays / empty video results
- `components/audiences/source-picker.tsx` — copy change
- Tests: `sources-act-prefix`, `source-cache`, `sources-fetch-independence`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] Scoped ESLint (touched paths)

## Notes

- Root issue: Meta Marketing API does not treat `lifetime` as a valid `date_preset` for the campaign insights field expansion used in `/{adaccount}/campaigns?fields=...`.
- Pages/IG pickers use `/api/audiences/sources/pages` only; they do not call `fetchAudienceCampaigns`. Stale empty cache could still make both UIs look broken after a bad response; cache rules now avoid that class of failure mode.
