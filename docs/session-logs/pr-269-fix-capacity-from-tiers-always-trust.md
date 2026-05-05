# Session Log

## PR

- **Number:** 269
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/269
- **Branch:** `fix/capacity-from-tiers-always-trust`

## Summary

Updates 4thefans capacity sync so tier-derived capacity is always treated as the source of truth whenever tier data is present, including stale non-placeholder seeded capacities.

## Scope / files

- `lib/db/ticketing.ts`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint <changed files>`
- [x] `npm run build`

## Notes

Edinburgh exposed seeded capacities like `1322` that were not placeholders but still stale compared with current 4thefans tier totals. The only remaining skip path is no tier capacity source.
