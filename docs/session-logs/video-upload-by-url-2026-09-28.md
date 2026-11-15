[Use Opus]

# Large videos 500 in the Storage → Meta proxy because Vercel buffers the whole file. Let Meta pull it by URL instead. One PR, `cursor/video-upload-by-url`, off fresh `main`. Open, don't merge.

Task #60: Bournemouth Presenter videos (V1 138 MB, V2 141 MB, V3 149 MB) reach Supabase Storage fine (TUS, #594/#597) and then `POST /api/meta/upload-asset` returns HTTP 500 on the Storage-path branch.

## Why

`app/api/meta/upload-asset/route.ts:110-135`:

```ts
const fileRes = await fetch(signedData.signedUrl);
videoBlob = await fileRes.blob();
const file = new File([videoBlob], …);
const bytes = new Uint8Array(await file.arrayBuffer());   // second full copy, for the dedupe hash
… uploadVideoAsset(adAccountId, file, …)                  // multipart re-upload to Meta
```

Three full copies of the video in one serverless invocation, then a 140 MB multipart POST to Meta from inside it, under `maxDuration = 300`. It works at 28 MB (the comment at :17 says so) and falls over well before 200 MB. Vercel's function memory and the 4.5 MB request-body ceiling are not the constraint here; time and heap are.

## Fix — Meta fetches, Vercel does not

Meta's `POST /act_{id}/advideos` accepts **`file_url`**: Meta downloads the video from a public URL itself. That is the same transport TikTok's `UPLOAD_BY_URL` mode uses (`TIKTOK_VIDEO_UPLOAD_MODE`). For the Storage-path branch, videos only:

1. Create the signed URL with a TTL long enough for Meta's fetch — Meta can take minutes on a large file; use 30 minutes, not 120 s. The path is a UUID under a per-user prefix; say in the PR body why a 30-minute signed URL is acceptable here.
2. `POST /advideos` with `file_url` (+ `name`, and whatever fields `uploadVideoAsset` already sends). **Verify the response shape on a live upload before writing the parser** — with `file_url` Meta returns the video id immediately but the video may not be ready; check whether `uploadVideoAsset`'s existing readiness poll (`status.video_status`) covers it, and if the id comes back before `status` is queryable, wait for it.
3. No bytes through Vercel: no `blob()`, no `arrayBuffer()`, no `File`.

Images stay on the current path — 30 MB, fine.

## The dedupe hash

`findExistingMetaChannelUpload` / `registerMetaUpload` key on a hash of the bytes. Without the bytes in Vercel there are two honest options; pick one and say which:

- **Client-side hash.** The browser already streams the file through TUS; hash it there (SHA-256 via `crypto.subtle`, streaming) and send `contentHash` in the body. The route trusts it for dedupe only — a wrong hash costs one duplicate upload, nothing else.
- **Storage-side.** Supabase returns an ETag/`cacheControl` metadata for the object; if that is a content hash for TUS uploads, use it. Check, don't assume.

Do not stream-hash inside the route as a middle ground; that keeps the time problem.

## Guards

No migration unless the registry needs a `hash_source` column — if so, write it, Matas applies. `lib/meta/upload.ts`'s validation constants stay. The raw-payload (non-Storage) branch is unchanged. Do not touch `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`. Env: if you add a mode switch mirroring TikTok's (`META_VIDEO_UPLOAD_MODE`), default it to the new path and document it in CLAUDE.md; the old path is the rollback.

If this environment has no Meta token, say so — the live `file_url` response is the one thing this PR cannot ship without, so mark it draft and describe what to capture.

## Test plan

Storage-path video → one `/advideos` call carrying `file_url`, zero `fetch` of the signed URL from the route (assert the route never calls `fetch` on `supabase.co/storage`). Dedupe: same hash twice → second returns the existing registry row, no Meta call. Signed URL TTL is 1800 s. Image path unchanged (golden). Live: one of the three Bournemouth files through the new path, with the Meta video id and readiness timing in the PR body.

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
