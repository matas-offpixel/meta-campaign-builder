# Session log — PR #342

## PR

- **Number:** 342
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/342
- **Branch:** `creator/audience-video-context-page-multi-shape`

## Summary

Bristol video-views audience creation failed with `contextId: null` because Bristol campaigns use Advantage+ / asset-feed creatives whose publishing Page ID is not at `creative.object_story_spec.page_id`. Extended `fetchAudienceCampaignVideos` to extract page IDs from all three Meta creative shapes (`object_story_spec.page_id`, `platform_customizations.{facebook,instagram}.page_id`, `asset_feed_spec.page_ids[]`), plus a video-level fallback: the most-common `from.id` across surviving videos is used as `contextPageId` when all creative-level extraction returns nothing.

## Scope / files

- `lib/audiences/sources.ts` — three-shape page ID extraction + `videoFromPageCounts` fallback
- `lib/audiences/__tests__/campaign-videos-route.test.ts` — 4 new assertions covering each new path

## Validation

- [x] `npm run build` — clean
- [x] `npm test` — 726/726 pass
- [x] `npx eslint` (scoped) — clean

## Notes

After deploy, retry the Bristol video-views audience. `contextId` should now resolve from `platform_customizations` or `asset_feed_spec`. The DB already has `contextId: 202868440480679` backfilled for existing failed queued audiences.
