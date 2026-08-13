# Session log

## PR

- **Number:** 768
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/768
- **Branch:** `cursor/video-image-url-only`

## Summary

PR #767 regression fix (task #128). `buildVideoCreative` stopped setting
both `video_data.image_url` and `image_hash` under the false assumption that
`thumb_offset` alone satisfies Meta's creative-create validator. Colyn V2
relaunch 2026-08-12 failed all 9 motion creatives with subcode=1443226
"Invalid parameter". Restores `image_url` from a live
`GET /{videoId}?fields=picture` (via PR #762's spinner-rejecting
`fetchVideoThumbnailWithRetry`) and still never calls App-Review-blocked
`POST /adimages` / never sets `image_hash`. Acceptable trade: Meta UI
Duplicate may hit 1443051 again; launches are the critical path.

## Scope / files

- `lib/meta/creative.ts` — `resolveVideoThumbnailImageUrl` + set
  `video_data.image_url`; `BuildCreativePayloadOpts.metaAccessToken` /
  `fetchVideoThumbnail` reintroduced (no upload opts)
- `app/api/meta/{launch-campaign,bulk-attach-ads,create-creatives-and-ads}/route.ts`
  — pass `metaAccessToken` again
- Docs in `video-upload-request.ts`, `client.ts`, `video-thumbnail-poll.ts`
- Tests: rewritten `creative-video-thumbnail.test.ts`; updated
  `creative-multi-placement` BOOK_NOW dual-video assertion

## Validation

- [x] Targeted `node --test` (creative-video-thumbnail, creative-multi-placement, video-upload-request) — 32/32 pass
- [x] `npx eslint` on touched files — 0 errors (pre-existing warnings only)
- [ ] Live: relaunch Colyn V2 → 9 motion creatives succeed

## Notes

- FIX 2 frame picker needs no code change: preferred thumb updates
  `GET /{videoId}?fields=picture`, which this path re-fetches at build time.
- Asset.thumbnailUrl is a fallback only when the live poll is empty / token missing.
