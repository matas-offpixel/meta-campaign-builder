# Session log — diagnose upload-asset persistent error

## PR

- **Number:** 534
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/534
- **Branch:** `cc/diagnose-upload-asset-persistent-error`

## Summary

PR #533 added a `createSignedUrl` retry loop but the "Failed to access stored file: Object not found"
error persisted in prod (3 × 500s at 17:36 UTC, files confirmed present in bucket). This PR adds
four `console.error` breadcrumb lines that will tell us exactly which step is failing on the next
run, plus `export const maxDuration = 300` to prevent Vercel from killing a 28 MB Meta upload
mid-flight.

## Diagnostics added

| Log line | Location | Tells us |
|---|---|---|
| `[upload-asset] start` | Before `createSignedUrl` retry loop | Route reached JSON path |
| `[upload-asset] signed-URL attempt failed n=` | Every failed `createSignedUrl` attempt | Exact Supabase error message |
| `[upload-asset] signed URL ok` | After retry loop succeeds | Which attempt worked |
| `[upload-asset] starting Meta upload` | Before `uploadVideoAsset` | Storage fetch + validation passed |
| `[upload-asset] Meta upload threw` | In video upload catch | Meta API error name + message |

## Diagnostic reading guide

| Pattern in logs | Root cause |
|---|---|
| `start` appears, `signed-URL attempt failed` appears with a non-"not found" error | Supabase auth / RLS issue — the server client can't see the file |
| `start` appears, `signed-URL attempt failed` appears 3× with a "not found"-style error | Storage propagation race not resolved by 1 250 ms + 1 000 ms budget — extend backoff |
| `signed URL ok` appears, `starting Meta upload` does NOT appear | `fetch(signedUrl)` returning non-200, or `validateAssetFile` rejecting |
| `starting Meta upload` appears, `Meta upload threw` appears | Meta API rejected upload — check error name/message for code |
| `starting Meta upload` appears, no `Meta upload threw`, request still 500 | Vercel function timeout during Meta upload — `maxDuration = 300` should fix |

## Scope / files

- `app/api/meta/upload-asset/route.ts`
  - `export const maxDuration = 300` added
  - 5 × `console.error` breadcrumbs added (all use `console.error` — Vercel surfaces these in Function logs)

## Validation

- [x] `npx tsc --noEmit` — no new errors
- [ ] Matas: run a dual-video upload and share Vercel Function logs

## Notes

- This is a diagnostics-only PR — no behavioural change other than `maxDuration`.
- Do not merge until logs from a fresh upload run are reviewed.
- Follow-up fix PR will target the root cause identified from these logs.
