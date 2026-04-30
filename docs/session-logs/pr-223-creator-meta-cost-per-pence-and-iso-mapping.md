## PR

- **Number:** 223
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/223
- **Branch:** `creator/meta-cost-per-pence-and-iso-mapping`

## Summary

Final BB26-KAYODE awareness share polish: Meta cost-per awareness tiles now preserve sub-penny values by rendering pence, and Meta country breakdown rows resolve ISO country codes such as `NG` to full country names.

## Scope / files

- `components/report/meta-insights-sections.tsx` for pence-aware Meta cost-per tile formatting.
- `lib/share/country-codes.ts` for ISO 2-letter country code labels.
- `lib/insights/meta.ts` for country breakdown label normalisation.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint components/report/meta-insights-sections.tsx lib/insights/meta.ts lib/share/country-codes.ts`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts' 'lib/insights/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes

- The requested broad ESLint scope (`components/report/ lib/insights/ lib/share/ lib/google-ads/`) still reports pre-existing React hook rule errors in `components/report/internal-event-report.tsx`.
