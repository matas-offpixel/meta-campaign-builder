# Session log — direct upload creatives

## PR

- **Number:** 462
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/462
- **Branch:** `cursor/creator/direct-upload-creatives`

## Summary

Static image uploads in the campaign creator's Creative step were failing with `FUNCTION_PAYLOAD_TOO_LARGE` for files over ~1 MB because the Next.js API route read the entire file body into memory before forwarding to Meta. Videos already used a Supabase Storage bypass (client → Supabase → server JSON pointer → Meta), but images still went through FormData → Vercel function body. This PR routes images through the same Supabase Storage path, so Vercel never sees the file body for either media type. The bulk-variation upload path in the Creatives step was also hitting this bottleneck directly (bypassed `useUploadAsset`); it now uses the same exported storage function. Meta's actual limits (30 MB images, 200 MB video) are now surfaced in the upload zone UI and enforced client-side before any network call.

## Scope / files

- `lib/meta/upload.ts` — exported `MAX_IMAGE_BYTES` / `MAX_VIDEO_BYTES` constants (previously unexported)
- `lib/hooks/useUploadAsset.ts` — removed `uploadViaFormData`; both image and video now go through a new exported `uploadAssetViaStorage` standalone function; hook simplified to delegate to it
- `app/api/meta/upload-asset/route.ts` — removed `type !== "video"` guard in the JSON/storage path; images now handled by that branch (download from Supabase → `uploadImageAsset` → clean up storage); FormData path kept for backward compatibility
- `components/steps/creatives.tsx` — imported `uploadAssetViaStorage` + `MAX_*` constants; replaced FormData fetch in `handleBulkVariationFiles` with storage-based upload; added pre-upload size guards in both single-slot and bulk upload paths; added `up to 30 MB` / `up to 200 MB` hints in upload zone

## Validation

- [x] `npx tsc --noEmit` — no new type errors (pre-existing test-file errors unrelated)
- [x] `npm run lint` — zero lint errors in changed files
- [x] 13 new unit tests in `lib/meta/__tests__/upload-asset-validation.test.ts` — all pass

## Notes

- Supabase Storage `FileOptions` does not expose `onUploadProgress` in `@supabase/storage-js` (fetches internally); granular byte-level progress bars are not available without switching to XHR. The two-phase nature (storage upload + Meta forward) is communicated by the existing spinner with "Uploading…" text — sufficient for now.
- The FormData path in the route is intentionally retained as a fallback for any callers that POST form-data directly (e.g. scripts, future external tooling). It won't be reached by the campaign wizard UI.
- No changes to the Meta creative payload contract, audience builders, rate-limit logic, or snapshot caches.
