# Session log

## PR

- **Number:** 916
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/916
- **Branch:** `cursor/tiktok-video-library-picker`

## Summary

TikTok's `▶ video` tab could only upload or paste. Meta can pick an existing post. This PR adds the missing third way: `choose from this account` lists videos already in the advertiser's TikTok asset library, and picking one fills the same `video_id` the paste path fills.

Live probe (read-only, 2026-09-07) confirmed `GET /file/video/ad/search/` — HTTP 200, TikTok `code: 0`, `{ list, page_info }`. One stored advertiser had `total_number: 0` (a real empty library). Another had 169 videos. First-row keys included `video_id`, `video_cover_url`, `duration`, `file_name`, `preview_url`, `preview_url_expire_time`. Rows are normalised through the same fallback chain as `fetchTikTokVideoInfo`. Spark Ads / organic posts stay PR 2.

## Scope / files

- `lib/tiktok/creative.ts` — `fetchTikTokVideoLibrary`, shared row mapper, copy constants
- `app/api/tiktok/creative/videos/route.ts` — session auth + `readTikTokAccountCredentials` (never `advertiser_ids[0]`)
- `components/tiktok-wizard/tiktok-video-library.tsx` — paginated grid; fetch on open, not on drawer mount
- `components/tiktok-wizard/steps/creatives.tsx` — third way in; multi-select → existing `appendUploadedTikTokCreatives` at `variationCount: 1`
- `lib/tiktok/video-preview.ts` — hide thumbs past `preview_url_expire_time`
- `lib/plan/drawer.ts` — `needsVideoTip` mentions choose (drawer InfoTip only)
- Tests: creative library path + empty list + source-guards; library picks; expired thumb

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5386 pass, 3 skipped)

## Notes

No new frame. Drawers are not in the 36-shot catalog; nothing on the canvas changes. `ENABLE_PLAN_FANOUT` and `OFFPIXEL_TIKTOK_WRITES_ENABLED` are untouched. Spark Ads (`tiktok_item_id` + identity) is blocked until Matas captures the Ads Manager request.
