# Session log — TikTok location label country resolution

## PR

- **Number:** 793
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/793
- **Branch:** `cursor/tiktok-location-label-country`

## Summary

`GB` rendered as "Aberdeen" because `countryCode` was matched before the
canonical country id. Resolve via `TIKTOK_LOCATION_IDS_BY_CODE` first, only
allow a `countryCode` match on `level === "COUNTRY"`, and index regions once.

## Scope / files

- `lib/tiktok-wizard/audience-display.ts`
- `lib/tiktok-wizard/__tests__/audience-display.test.ts`
- `components/tiktok-wizard/steps/audiences.tsx`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 3891 = 3875 passed + 13 failed + 3 skipped

## Notes

- `lib/tiktok/audience.ts` unchanged. Mapped region rows still have
  `id` / `name` / `countryCode` only — no `level` is forwarded — so the
  countryCode fallback does not fire in prod. ISO codes resolve through
  the canonical GeoNames id.
