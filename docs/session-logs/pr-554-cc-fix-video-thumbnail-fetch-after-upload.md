# Session log — fix-video-thumbnail-fetch-after-upload

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/fix-video-thumbnail-fetch-after-upload`

## Summary

Meta's POST /advideos response never includes `picture` or `preview_image_url`
— the video is still ENCODING at upload time. Since uploadVideoAsset was first
written it has been silently returning `previewUrl=""` for every video upload.
This was invisible until PR #551 started plumbing `thumbnailUrl → image_url`;
Meta then rejected every video ad with code=100 subcode=1443226.

Fix: after the POST succeeds (videoId captured), poll GET /{videoId}?fields=picture
twice (3 s apart, 6 s max). Return the picture URL when available; fall through
to `""` + `console.error` WARNING after both attempts fail.

## Scope / files

- `lib/meta/video-thumbnail-poll.ts` — new: `fetchVideoThumbnailWithRetry(videoId, token, _pollDelayMs=3000)`; extracted into its own module so tests can import without pulling in MetaApiError (which uses TS parameter properties incompatible with `--experimental-strip-types`)
- `lib/meta/client.ts` — `uploadVideoAsset`: replaced one-liner `previewUrl` fallback with `fetchVideoThumbnailWithRetry` call; added import
- `lib/meta/__tests__/upload-video-thumbnail.test.ts` — 10 unit tests via globalThis.fetch mock + injected 0ms delay (all pass, fast)
- `app/api/admin/refresh-video-thumbnail/[videoId]/route.ts` — new utility POST endpoint for backfilling thumbnailUrl on existing assets without re-uploading

## Validation

- [x] `npx tsc --noEmit` — 0 new errors
- [x] 10/10 tests pass (`node --experimental-strip-types --test lib/meta/__tests__/upload-video-thumbnail.test.ts`)
- [ ] Manual test: re-upload a J2 Melodic video and confirm `thumbnailUrl` is non-empty in the draft state
- [ ] Vercel preview green

## Notes

- `_pollDelayMs` defaults to 3000ms in production; injectable for tests (0ms)
- The WARNING is logged via `console.error` per Vercel filter memory
- `uploadImageAsset` is unchanged (different code path)
- `fetchVideoThumbnailWithRetry` is exported for use by the admin backfill route
- Total extra upload latency: 3s (success on attempt 1) or 6s (both attempts exhausted). Both well within `maxDuration=300`
