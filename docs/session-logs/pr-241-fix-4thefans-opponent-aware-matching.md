## PR

- **Number:** 241
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/241
- **Branch:** `fix/4thefans-opponent-aware-matching`

## Summary

Adds opponent-aware scoring to ticketing link discovery so same-venue 4thefans events for different opponents separate cleanly, while keeping venue confidence as the auto-link gate.

## Scope / files

- Ticketing link-discovery scoring weights and opponent extraction fallback
- Bristol Croatia / Panama / Last 32 matcher regression tests
- Discovery API payload and candidate-row debug score toggle

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "lib/ticketing/link-discovery.ts" "lib/ticketing/__tests__/link-discovery.test.ts" "app/api/clients/[id]/ticketing-link-discovery/route.ts" "components/dashboard/clients/ticketing-link-discovery.tsx"`
- [x] `node --test lib/ticketing/__tests__/link-discovery.test.ts`

## Notes

The matcher reuses `extractOpponentName()` first, then applies link-discovery-specific fallbacks for reversed home-team names and knockout labels such as `Last 32`. The allocator helper still keeps knockout events generic.
