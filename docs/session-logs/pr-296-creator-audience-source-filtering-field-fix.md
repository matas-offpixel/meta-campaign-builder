## PR

- **Number:** 296
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/296
- **Branch:** `creator/audience-source-filtering-field-fix`

## Summary

Fixed Meta Graph error `(#100) Filtering field 'time_created' is not supported` in the Audience Builder source campaign picker by using `created_time` in the `/act_{id}/campaigns` filtering array, matching the `fields` parameter already on that call. Added a regression test in `sources-act-prefix.test.ts` that asserts `fetchAudienceCampaigns` keeps `created_time` in the filtering JSON (runtime import of `lib/audiences/sources.ts` is not used in tests because it pulls in `lib/meta/client.ts`, which uses TypeScript syntax outside Node strip-types support).

## Scope / files

- `lib/audiences/sources.ts` — filtering field name
- `lib/audiences/__tests__/sources-act-prefix.test.ts` — regression

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint lib/audiences/sources.ts lib/audiences/__tests__/sources-act-prefix.test.ts`

## Notes

Manual smoke: `/audiences/<clientId>/new` → Bottom Funnel → Source campaign dropdown should load without `#100`.
