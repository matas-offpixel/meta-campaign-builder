# Session log — TikTok video upload

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/tiktok-video-upload`

## Summary

The Creatives step could only accept a pasted video_id. Upload now goes
browser → Supabase Storage (TUS above 40 MB) → `/api/tiktok/creative/upload`
→ `/file/video/ad/upload/` with a server-computed MD5. Smart Fix is sent
explicitly false. A video_id-only latency response backfills metadata from
`/file/video/ad/info/` without blocking use of the video.

## Scope / files

- `lib/tiktok/upload.ts` — FILE + URL modes, envelope + timing logs
- `app/api/tiktok/creative/upload/route.ts` — session auth, Storage path only
- `lib/tiktok-wizard/campaign-asset-upload.ts` — browser Storage + TUS
- `components/tiktok-wizard/steps/creatives.tsx` — drag/drop + paste path
- `lib/tiktok/__tests__/upload.test.ts`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 3907 = 3891 passed + 13 failed + 3 skipped
- [x] Changed-file eslint clean

## Notes

- Default mode is `UPLOAD_BY_FILE`. Override with `TIKTOK_VIDEO_UPLOAD_MODE=UPLOAD_BY_URL`
  or a `mode` field on the route body (measurement).
- Timing log format:
  `[tiktok/upload] mode=<UPLOAD_BY_FILE|UPLOAD_BY_URL> advertiser=<id> bytes=<n> elapsedMs=<n> outcome=<ok|timeout|error> code=<n>`
- Fetchers in `lib/tiktok/audience.ts` unchanged. Smart Fix off. Image upload not implemented.
