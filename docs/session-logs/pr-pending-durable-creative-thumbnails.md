# Durable TikTok creative thumbnails, Meta 64px video previews

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/durable-creative-thumbnails`

## Summary

TikTok snapshot thumbnails are signed CDN URLs that expire about six hours
after the cron read, so the venue Top creatives section (#1072) and the
per-event share report fell back to placeholders. The `tiktok-active-creatives`
cron now stores each ad's video cover or image in the `creative-thumbnails`
bucket under `tiktok/`, and both readers serve that object first. Separately,
Meta video ads whose preview tier is the 64px `top_thumbnail_url` now get the
cached video thumbnail on the live fetch path, as `afs_video_thumb` ads
already did.

## Scope / files

- `lib/tiktok/thumbnail-cache.ts`: Storage-first cache keyed by video_id
  (`tiktok/video/{advertiser_id}/{video_id}.jpg`) or image_id
  (`tiktok/image/{advertiser_id}/{image_id}.jpg`, "/" → "__"). TikTok only on a
  miss, batched 60 (video) / 100 (image) per call, 20 calls per run, in-flight
  dedupe per id. Downloads must be `image/*`; the signed URL is never stored.
  `ENABLE_TIKTOK_THUMBNAIL_FETCH="0"` makes no TikTok call or download.
- `lib/tiktok/thumbnail-cache-run.ts`: one pass per TikTok account, shared by
  the cron and the backfill. Advertiser id is `tiktok_accounts.tiktok_advertiser_id`,
  the same value the reader uses.
- `lib/tiktok/creative.ts`: `fetchTikTokImageInfo` (`/file/image/ad/info/`).
  Videos reuse `fetchTikTokVideoInfo` (`video_cover_url`).
- `app/api/cron/tiktok-active-creatives/route.ts`: after the snapshot writes,
  caches thumbnails and logs `tiktok_thumb_calls= tiktok_thumb_cached=
  tiktok_thumb_stored= tiktok_thumb_missing= tiktok_thumb_rows_without_ids=`.
- `lib/tiktok/snapshots.ts`: `readActiveTikTokCreativesSnapshot` returns the
  Storage URL when an object exists, else the stored URL while unexpired,
  else null. Storage list only, no TikTok call on render.
- `app/share/report/[token]/page.tsx`: the TikTok creatives grid reads the
  table directly, so it goes through the same resolver.
- `lib/dashboard/venue-tiktok-creatives-view.ts`: #1072's card-level expiry
  filter removed; the reader does it after trying the durable URL.
- `lib/reporting/group-tiktok-creatives.ts`: grouping tier 1 prefers the row's
  `video_id` over the URL's `VideoID`, so a Storage URL or a dropped URL does
  not regroup concepts.
- `lib/reporting/active-creatives-thumbnail.ts` + `active-creatives-fetch.ts`:
  `videoIdToUpgrade`. Every low-res tier with a video id is upgraded through
  `fetchVideoThumbnailsBatch` (the existing `fetchThumbnailUrl` path). No new
  Meta `/thumbnails` call site.
- `scripts/backfill-tiktok-thumbnails.mts`: dry run by default, `--apply`
  writes, `--client` or `--event-code`, counts only.
- `CLAUDE.md`: `ENABLE_TIKTOK_THUMBNAIL_FETCH`.

No migration: the bucket is public and service-role uploads already work.

## Findings

**IRWOHD (Brand Awareness) nulls.** All 26 of the 49 ads with a null
`thumbnail_url` have neither `video_id` nor `image_ids`. They are Spark ads that
carry only `tiktok_item_id` (identity BC_AUTH_TT ×24, AUTH_CODE ×2). No
video-id or image-id key reaches them. A follow-up could read the post cover
through `lib/tiktok/spark-posts.ts` (`/tt_video/list/`, `video_info.poster_url`).

**Backfill dry run, IRWOHD:** 49 ads. 23 would get a durable thumbnail (15
distinct videos, 1 TikTok info call). The 26 Spark item-only ads stay without
one. Whole Ironworks client (4 events with snapshots): 170 videos in 4 calls.
298 of 333 ads would get one; the other 35 are Spark item-only.

**Meta 64px (Part B).** Latest Ironworks snapshots, 133 concept groups, 89
of them video: 62 on `video_data_image_url` and 27 on `top_thumbnail_url`.
87 of the 89 already have a large `video-thumb/` object.
1. Live fetch path: the enrichment gate only upgraded `afs_video_thumb`, so the
   27 `top_thumbnail_url` videos kept their 64px. Fixed here.
2. Card thumbnails go through the ad_id proxy (`lib/meta/thumbnail-proxy-server.ts`).
   It prefers `creative.thumbnail_url` (64px) over the video's cached thumbnail,
   and `{adId}.{ext}` cache hits never refresh. All 89 video concepts have a
   proxy object of about 1.2 to 1.4 KB. Fixing that means editing `lib/meta/**`
   (read only for this thread) and purging those objects. Not done here.
3. 22 `top_image_url` concepts with no video and no image hash also look 64px.
   Not investigated.

## Validation

- [x] `npx tsc --noEmit` (no errors in touched files)
- [x] ESLint on touched files (0 errors)
- [x] `npm run build`
- [x] `npm test`
- [x] `scripts/backfill-tiktok-thumbnails.mts --event-code IRWOHD` (dry run only)

## Notes

`--apply` has not been run. Run it once, or let the next cron pass fill the
cache (20 calls per run covers 1,200 videos).
