# Session log: feat(creator): live geo-resolution preview in wizard + shared resolver

## PR

- **Number:** 452
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/452
- **Branch:** `creator/google-search-live-geo-preview`

## Summary

Adds a live geo-resolution preview to the Google Search wizard's Targeting & Budget step so operators see exactly what Google Ads will target before pushing. Introduces `lib/google-ads/geo-resolve.ts` as the single source of truth shared by both the preview API route and the push adapter — eliminating any divergence risk. Also fixes the copy-paste bug in PR #451's UK fallback map where Wales was incorrectly mapped to England's geoTargetConstant ID.

## Scope / files

- `lib/google-ads/geo-resolve.ts` — new single-source-of-truth resolver (`resolveGeoLocation` singular for the route; `resolveGeoLocations` batch for the push adapter). Wales fixed to ID `20338`.
- `lib/google-ads/geo-suggest.ts` — converted to a backwards-compat re-export barrel from `geo-resolve.ts`.
- `lib/google-ads/client.ts` — extended `suggestGeoTargetConstants` return type to include `countryCode` and `targetType`; `canonicalName` preferred over `name`.
- `lib/google-ads/campaign-writer.ts` — imports from `geo-resolve.ts`; batch pre-resolve skips locations with `resolved_resource_name`; `pushCampaignGeoCriteria` prefers pre-resolved IDs over live suggest.
- `lib/google-search/types.ts` — `GoogleSearchGeoTarget` extended with optional `resolved_resource_name` and `resolved_name` fields.
- `lib/google-search/geo-targets-codec.ts` — `normaliseTargets` preserves `resolved_resource_name` / `resolved_name` fields through encode/decode cycle; legacy entries without them continue to decode fine.
- `lib/google-search/validation.ts` — `softWarnings` adds `geo_target_unresolved` warning for targets explicitly resolved to null by the wizard preview.
- `app/api/google-search/resolve-geo/route.ts` — new POST route; cookie-bound auth; uses `resolveGeoLocation` from `geo-resolve.ts`; returns `{ ok, matches }`.
- `components/google-search-wizard/steps/targeting-budget.tsx` — `GeoRow` component with 450ms debounced live preview (Loader → ✓ green / ⚠ amber); stores resolved IDs onto the tree on match.
- `lib/google-ads/__tests__/geo-resolve.test.ts` — new tests for `geo-resolve.ts` (Wales fix assertion, fallback, suggest primary, batch caching, re-export identity check).
- `lib/google-ads/__tests__/geo-preview.test.ts` — new tests for codec round-trip (resolved fields, legacy), push adapter (pre-resolved skips suggest, fallback works, mixed batch).
- `lib/google-ads/__tests__/geo-suggest.test.ts` — updated fake client to match new return type.
- `lib/google-ads/__tests__/campaign-writer.test.ts` — updated fake client to match new return type.

## Validation

- [x] `npx tsc --noEmit` — 0 new errors in my files (pre-existing audience test errors unchanged)
- [x] `npx eslint lib/google-ads/ lib/google-search/ app/api/google-search/ components/google-search-wizard/` — 0 errors, 1 pre-existing warning
- [x] `node --experimental-strip-types --test` — 203/203 pass
- [x] `npm run build` — success

## Notes

- Wales was mapped to `geoTargetConstants/20339` (England's ID) in PR #451. Correct ID is `20338`. Fixed in `GEO_TARGET_CONSTANTS_MAP`.
- The `resolved_resource_name: null` (explicit null, not `undefined`) signals "wizard tried and found no match" — the validation warning triggers on this. `undefined` / absent means the field was never set (XLSX-imported plan), which does NOT trigger the warning.
- Push adapter correctly handles three cases: (1) pre-resolved (skip suggest), (2) unresolved with live suggest, (3) mixed batch.
- No migration needed — `geo_targets` is already a `jsonb` column; new fields are additive and optional.
