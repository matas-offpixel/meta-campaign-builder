# Session log — PR #343

## PR

- **Number:** 343
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/343
- **Branch:** `creator/audience-video-retention-days`

## Summary

Video-views custom audiences POST with a bare JSON array `rule` that carries no retention. Meta defaults retention to 730 days when top-level `retention_days` is missing. Added `retention_days: String(audience.retentionDays)` on the `video_views` path only. Engagement and pixel paths unchanged (retention remains in `rule.retention_seconds`).

## Scope / files

- `lib/meta/audience-payload.ts` — video_views return includes `retention_days`
- `lib/meta/__tests__/audience-write.test.ts` — assertions for video `retention_days`, pixel omits it

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint` (scoped)

## Notes

Audience `6984690056065` (Bristol) keeps 730d until edited in Ads Manager or recreated after deploy.
