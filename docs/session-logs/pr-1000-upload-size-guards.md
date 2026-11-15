# Session log — upload size guards

## PR

- **Number:** 1000
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1000
- **Branch:** `cursor/upload-size-guards`

## Summary

Creatives-slot uploads now decide locally before any request: images over 30 MB and videos over 200 MB are refused with the file size and the limit, and videos over 30 MB (up to 200 MB) upload unchanged after a one-line Storage notice. The upload route still runs on the Node.js runtime (no `export const runtime`, so not edge), which is why sharp can recompress an image over 30 MB to a JPEG at or under that limit before `uploadImageAsset`. Images at or under 30 MB stay on the existing byte-for-byte path. The #997 `file_url` branch was not touched.

## Scope / files

- `lib/meta/upload-size-guard.ts` — `planCreativeUpload` client decision
- `components/steps/creatives.tsx` — `handleFile` uses the plan, renders the large-video notice and compressed size
- `lib/meta/compress-upload-image.ts` — sharp JPEG compression (quality from 92, then scale)
- `lib/meta/upload.ts` — optional `compressedBytes` on the upload result; image byte-limit skip only when the route asks
- `app/api/meta/upload-asset/route.ts` — image branches only, plus the size-check skip that lets those branches run; `file_url` unchanged
- `lib/meta/__tests__/upload-size-guards.test.ts`

## Validation

- [x] `npm test` — 6447 tests, 6443 pass, 4 skipped, 0 fail
- [x] `npm run build` — compiled in 16.4s, TypeScript in 34.8s. The only warning is the known `render-reel` `export const config`.
- [ ] CI check-run conclusions (reported in the thread, not committed)

## Notes

Route runtime is nodejs, so sharp is used for oversized images. `file_url` (`metaVideoUploadMode`, `uploadStoredVideoByUrl`, `downloadSignedStorageObject`) was not modified. No server-side video compression. No new dependency; sharp stays in devDependencies. The slot notice and the compressed-size line are `StatusLine`s, because a raw paragraph fails the creator-surface chrome guard.
