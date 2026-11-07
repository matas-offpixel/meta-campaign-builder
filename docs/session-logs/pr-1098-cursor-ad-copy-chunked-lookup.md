# Session log

## PR

- **Number:** 1098
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1098
- **Branch:** `cursor/ad-copy-chunked-lookup`

## Summary

Ad copy `.in()` lookups were one URL of 1,000 ids, which Supabase rejects above about 16KB. Every lookup now goes through one helper in chunks of 150, under 8KB. Upserts are unchanged.

## Scope / files

- `lib/ad-daily-insights/id-lookup.ts`
- `lib/ad-daily-insights/copy-capture.ts`
- `scripts/backfill-ad-copy.mts`
- `lib/ad-daily-insights/__tests__/copy.test.ts`

## Validation

- [x] `npm test` (7686 tests, 0 fail)
- [x] `npm run build`
- [ ] Backfill `--apply` against production

## Notes

`runner.ts` has no `.in()` lookup. No migration.
