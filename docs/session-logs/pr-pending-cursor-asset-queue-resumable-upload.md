# Session log

## PR

- **Number:** pending
- **URL:** (pending)
- **Branch:** `cursor/asset-queue-resumable-upload`

## Summary

Replace simple Supabase Storage upload with TUS resumable protocol for files >40 MB in the asset queue prepare route. The storage-js simple upload has a hidden ~50 MB body limit even on Pro plan; TUS supports up to 50 GB. Bournemouth1.mp4 (76 MB) was failing with "The object exceeded the maximum allowed size".

## Scope / files

- `lib/clients/asset-queue/storage-upload.ts` — new utility: `uploadResumableTus` (TUS via fetch), `uploadToStorageBucket` (threshold router)
- `app/api/.../prepare/route.ts` — replaces direct `.storage.upload()` calls with `uploadToStorageBucket`; logs when resumable path taken
- `lib/clients/asset-queue/__tests__/storage-upload.test.ts` — 11 tests

## Validation

- [x] `node --test lib/clients/asset-queue/__tests__/storage-upload.test.ts` — 11/11 pass
- [x] `npm run build`
- [ ] Bournemouth Presenter videos prepare (post-merge, Matas)

## Notes

- No new npm dependencies — TUS implemented directly via `fetch`
- `MAX_SINGLE_FILE_BYTES` (200 MB) and `MAX_FOLDER_BYTES` (2 GB) unchanged
- Files ≤40 MB continue to use the storage-js simple path
- Vercel log line `[asset-queue/prepare] Using resumable upload` confirms the path in production
