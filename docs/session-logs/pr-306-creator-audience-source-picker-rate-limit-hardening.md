## PR

- **Number:** 306
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/306
- **Branch:** `creator/audience-source-picker-rate-limit-hardening`

## Summary

Reduced Audience Builder source-picker pressure on Meta (#80004): extended in-memory server cache to 30 minutes, deduplicated in-flight browser fetches per URL so preset bundles don’t multiply identical Graph-backed requests, mapped Meta account rate-limit errors to HTTP 429 with a structured body, and updated the picker + create form to show a clear message (no endless spinner) and disable “Save + create on Meta” while drafts still save. Added client prefetch on `/audiences/[clientId]` to warm pages/pixels/campaigns cache before opening the funnel form.

## Scope / files

- `lib/audiences/source-cache.ts`, `lib/audiences/meta-rate-limit.ts`, `lib/audiences/source-picker-fetch.ts`
- `app/api/audiences/sources/*/route.ts`
- `components/audiences/source-picker.tsx`, `components/audiences/audience-source-prefetch.tsx`
- `app/audiences/[clientId]/page.tsx`, `app/audiences/[clientId]/new/audience-create-form.tsx`
- Tests under `lib/audiences/__tests__/`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] ESLint on touched paths

## Notes

Manual: load `/audiences/:clientId`, then open preset bundle — network tab should show at most one request per distinct source URL (plus prefetch). Simulate 429 from API to confirm amber rate-limit copy and disabled Meta publish button.
