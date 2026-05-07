# Session log (pending PR)

## PR

- **Number:** pending
- **URL:** (after `gh pr create`)
- **Branch:** `thread/club-football-allocator-fix`

## Summary

Fixes `ad_spend_allocated` staying NULL for Club Football and other non-WC26 products: the venue allocator used to **skip** singleton venues (`solo_event_skipped`) and relied on opponent-based ad matching for multi-fixture rows, so dashboard SPEND (PR #171) read NULL and showed £0. Singletons now pass through Meta `ad_spend` / presale into allocation columns; multi-fixture non-WC26 `event_code` groups get an **equal split** of rollup rows across siblings. WC26 `event_code` values keep the existing opponent + umbrella allocator unchanged.

## Scope / files

- `lib/dashboard/venue-equal-split.ts` — pure WC26 check + equal monetary split
- `lib/dashboard/venue-spend-allocator.ts` — solo pass-through, non-WC26 equal split, then existing WC26 path
- `lib/dashboard/__tests__/venue-spend-allocator-split.test.ts`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint` (changed files)

## Notes

- Post-deploy: backfill per event via admin rollup route as in product brief; regression-check a WC26 multi-venue event.
