# Session log — PR #341

## PR

- **Number:** 341
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/341
- **Branch:** `creator/audience-pixel-no-subtype-and-video-page-filter`

## Summary

Two fixes to close out the audience-builder arc. (1) Pixel audiences: removed `subtype: "WEBSITE"` from the POST payload — same root cause as engagement (PR #340); Meta's deprecated `subtype` field triggers `#2654 subcode 1870053`. (2) Video-views audiences: `fetchAudienceCampaignVideos` now fetches the `from` field on each video and drops any that lack `from.id` (orphan videos uploaded directly to the ad account, not published from a FB Page). A `skippedCount` propagates through the fetch layer to the UI as an amber info note.

## Scope / files

- `lib/meta/audience-payload.ts` — removed `subtype: "WEBSITE"` from pixel return
- `lib/audiences/sources.ts` — added `from` to video fields; orphan filter; `skippedCount` in return
- `lib/audiences/source-picker-fetch.ts` — `skippedCount` added to `CampaignVideosPayload`
- `components/audiences/source-picker.tsx` — aggregate and display `skippedCount` in `VideoSourcePicker`
- `lib/meta/__tests__/audience-write.test.ts` — pixel test now asserts no `subtype` field
- `lib/audiences/__tests__/campaign-videos-route.test.ts` — asserts `from` field fetched and orphan filter present

## Validation

- [x] `npm run build` — clean
- [x] `npm test` — 722/722 pass
- [x] `npx eslint` (scoped) — clean

## Notes

After deploy, retry pixel audiences (no `subtype`) and video-views audiences (orphan videos will be silently dropped + UI shows count). If video audiences still fail, the next diagnostic step is to verify `contextId` (Page ID) is being resolved correctly from ad creatives.
