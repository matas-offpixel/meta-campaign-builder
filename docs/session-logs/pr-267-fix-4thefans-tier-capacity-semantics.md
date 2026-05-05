# Session Log

## PR

- **Number:** 267
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/267
- **Branch:** `fix/4thefans-tier-capacity-semantics`

## Summary

Corrects the 4thefans tier semantics after production backfill verification: parsed tier availability remains provider remaining availability, event capacity uses sold plus remaining, and persisted tier rows store sold plus remaining as the display allocation.

## Scope / files

- `lib/ticketing/fourthefans/parse.ts`
- `lib/ticketing/tier-capacity.ts`
- `lib/db/ticketing.ts`
- `lib/ticketing/__tests__/fourthefans-provider.test.ts`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint <changed files>`
- [x] `npm run build`

## Notes

The first production backfill populated tiers but inflated Brighton capacities because `quantity_available` had been converted to allocation too early. This keeps raw parser output and stored display rows separate.
