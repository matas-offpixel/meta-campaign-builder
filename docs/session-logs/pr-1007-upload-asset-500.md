# Session log

## PR

- **Number:** 1007
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1007
- **Branch:** `cursor/upload-asset-500`

## Summary

A Meta rejection of an undecodable image on the storage upload path was rethrown, so Next answered with an empty 500 and the Creatives slot showed "HTTP 500". The route now returns that failure as JSON, using Meta's `error_user_msg` when Graph sends one.

## Scope / files

- `app/api/meta/upload-asset/route.ts` — thin POST wrapper
- `lib/meta/upload-asset-handler.ts` — storage and FormData upload paths; every throw becomes a JSON body
- `lib/meta/client.ts` — `uploadImageAsset` keeps Graph `error_user_msg` and `error_subcode`
- `lib/meta/__tests__/upload-asset-image.test.ts` — stubbed Meta on both image paths
- `lib/meta/__tests__/upload-size-guards.test.ts`, `lib/meta/__tests__/storage-video-by-url.test.ts` — source scans follow the moved handler

## Validation

- [x] `npm run build` (TypeScript check included; the pre-existing Remotion `config` warning is unchanged)
- [x] `npm test` — 6537 passed, 4 skipped, 0 failed

## Notes

Suspects ruled out by the local stack: sharp never loaded on this request, `findExistingMetaChannelUpload` accepted the bytes, and images omit `contentHash` / `byteSize` on purpose. A real under-5 MB 9:16 JPEG returned 201. The production 500s were Meta subcode 2446496 on bytes it could not decode.
