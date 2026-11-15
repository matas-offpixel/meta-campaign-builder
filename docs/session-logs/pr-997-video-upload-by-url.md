# Session log — Storage videos upload by URL

## PR

- **Number:** 997
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/997
- **Branch:** `cursor/video-upload-by-url`

## Summary

`POST /api/meta/upload-asset` was downloading a Storage video into the function (`blob()`, then `arrayBuffer()`, then a multipart POST to Meta). A 140 MB file died with HTTP 500. The `file_url` path signs the object for 30 minutes and lets Meta download it, and it does not fetch that URL. It is opt-in: `META_VIDEO_UPLOAD_MODE` unset stays on the multipart download. `file_url` runs only when the env var is exactly `file_url`. The default flips after one live Bournemouth upload is confirmed.

## Scope / files

- `lib/meta/video-file-url.ts` — mode (unset is multipart; exactly `file_url` opts in), 1800 s TTL, request body (`file_url`, `name`, `title`, `thumb_offset`), id parser, `video_status` wait. `downloadSignedStorageObject` is the unchanged multipart download.
- `lib/meta/storage-video-by-url.ts` — the storage-path video orchestrator. No `blob()`, `arrayBuffer()`, or `File`.
- `app/api/meta/upload-asset/route.ts` — calls the orchestrator only when the mode is exactly `file_url`. Otherwise, including unset, it still downloads the signed URL. Images always download.
- `lib/creatives/sha256-stream.ts` + `lib/hooks/useUploadAsset.ts` — the browser hashes the File while streaming it, and sends `contentHash` and `byteSize`. The route trusts the hash for dedupe only.
- `lib/creatives/register-upload.ts` — registry lookup and insert accept that identity when the route has no bytes. No migration. No `hash_source` column.
- `CLAUDE.md` — `META_VIDEO_UPLOAD_MODE`.

## Why the hash is client-side

Supabase's object ETag is not the SHA-256 `creative_assets.content_hash` already uses. A simple upload's ETag is MD5. A TUS/multipart upload's ETag is an S3 multipart tag (`md5-of-part-md5s-N`). Either one would miss every existing row. The browser SHA-256 matches `fingerprintBytes`. A wrong hash skips dedupe and uploads a duplicate. It does not change what Meta receives.

## Why 30 minutes

The object key is `videos/<uuid>.<ext>` in `campaign-assets`. There is no per-user prefix; the UUID is the unguessable part. The bucket has no SELECT policy, so the object is not listable. The signed URL is created on the server and sent only as `file_url`. It expires after 1800 s, which is long enough for Meta to pull ~150 MB. The error path does not log the URL.

## Readiness

`uploadVideoAsset`'s existing poll reads `picture`, not `status.video_status`. It does not cover a `file_url` id that exists before the video node is queryable. This path polls `GET /{id}?fields=status` first (not-queryable and `processing` keep waiting; `error` fails the upload; a timeout still returns the id) and then runs the existing thumbnail poll.

The id parser is the multipart path's parser: `id`, then `video_id`. No live `file_url` body was captured. This environment has no Meta token.

## Not touched

`lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`, `lib/meta/upload.ts` size constants, the FormData branch, and `app/api/clients/[id]/asset-queue/[queueId]/upload-to-meta` (that path still downloads). No migration.

## Validation

- [x] `npm test` — 6435 tests, 6431 pass, 4 skipped, 0 fail
- [x] `npm run build` — compiled in 15.9s, TypeScript in 32.8s. The only warning is the known `render-reel` `export const config`. Built against a hardlinked `node_modules`; the worktree symlink is restored.
- [ ] CI check-run conclusions (reported in the thread, not committed)

## Notes

Live capture still required before treating the parser as confirmed. One of the Bournemouth Presenter files (V1 138 MB, V2 141 MB, V3 149 MB) through the new path. Record the `POST /advideos` status and JSON keys (and which field holds the id), then `GET /{id}?fields=status` timestamps until `video_status` is `ready`, including whether the first GET errors, and when `picture` becomes a real frame.
