# Session log — PR #354

## PR

- **Number:** 354
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/354
- **Branch:** `creator/audience-video-fetch-rate-limit-safe`

## Summary

Reduced `/campaign/{id}/ads` page size from 500 to 100 to avoid Meta's "reduce data" / oversized-response failures on campaigns with heavy nested creatives. Added cursor-based paging (max 50 pages) so campaigns with more than 100 ads still enumerate all ads. Replaced unbounded parallel per-video Graph calls with 5-concurrent chunked batches (`VIDEO_FETCH_CONCURRENCY`), aligning with the bulk-video runner approach.

## Scope / files

- `lib/audiences/sources.ts` — ads paging + chunked video metadata fetch; indentation fixed inside chunk callback
- `lib/audiences/__tests__/campaign-videos-route.test.ts` — assertions for rate-limit-safe patterns

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint` (scoped)
