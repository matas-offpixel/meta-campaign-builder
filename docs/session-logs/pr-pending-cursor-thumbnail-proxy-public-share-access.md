# PR #528 — fix(middleware): allow public access to creative-thumbnail proxy

**Branch:** `cursor/thumbnail-proxy-public-share-access`
**PR:** pending
**Date:** 2026-06-03

## Problem (demo blocker)

Incognito visitors on `/share/report/[token]` saw placeholder Meta creative
thumbnails because `/api/proxy/creative-thumbnail` returned **307 → /login**.
Authenticated Off Pixel sessions worked fine.

The route handler (`lib/meta/creative-thumbnail-get.ts`) already supports
`share_token` auth, but `lib/supabase/proxy.ts` middleware redirected
unauthenticated requests before the handler ran.

Legacy `/api/meta/thumbnail-proxy` had a partial carve-out (only when
`share_token` was present in query params), but share pages now use
`/api/proxy/creative-thumbnail` which was not on the public list at all.

## Fix

Added `PUBLIC_API_ROUTES` in `lib/auth/public-routes.ts`:

- `/api/proxy/creative-thumbnail`
- `/api/meta/thumbnail-proxy`

Both bypass session middleware unconditionally; the route handler enforces
`share_token` vs authenticated `client_id` and returns 401/403/404 on failure.

## Files changed

| File | Change |
|------|--------|
| `lib/auth/public-routes.ts` | PUBLIC_API_ROUTES + isPublicApiRoute |
| `lib/auth/__tests__/public-routes.test.ts` | Tests for both proxy paths |

## Tests

```
16/16 pass (public-routes)
```
