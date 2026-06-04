# Session log — fix upload-asset signed-URL retry

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/fix-upload-asset-signed-url-retry`

## Summary

Fixed an intermittent "Failed to access stored file: Object not found" race condition in the dual-asset video upload flow. When two files are uploaded to Supabase Storage in parallel, Storage's internal index occasionally hasn't propagated by the time the server calls `createSignedUrl`. Added a 3-attempt exponential-backoff retry (0 ms → 250 ms → 1 000 ms) around `createSignedUrl` in `app/api/meta/upload-asset/route.ts`, gated only on "not found"-style errors so auth failures and other modes still surface immediately.

## Scope / files

- `app/api/meta/upload-asset/route.ts` — retry loop around `createSignedUrl` (lines 63–103)

## Validation

- [x] `npx tsc --noEmit` — no new errors introduced (pre-existing failures in unrelated test files)
- [ ] `npm run build`
- [ ] Manual: dual-video upload at `/campaign/[draft-id]` → Creatives → Dual (4:5 + 9:16) → Bulk Upload two files

## Notes

- Bucket name, upload path, and signed-URL TTL (120 s) are all unchanged.
- No client-side delay added.
- Retry logs emit as `console.error` so they surface in Vercel Function logs (Vercel filters `console.log`).
