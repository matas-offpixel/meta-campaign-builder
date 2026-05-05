## PR

- **Number:** 263
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/263
- **Branch:** `creator/settings-reconnect-popup-redirect-fix`

## Summary

Facebook reconnect now embeds the safe `next` destination in the direct OAuth state as a fallback, so Settings reconnect can return to `/settings` even when the `fb_oauth_next` cookie is dropped on Facebook's cross-site callback.

## Scope / files

- `app/api/auth/facebook-start/route.ts` sanitizes the requested `next` path and embeds it in the direct OAuth `state` using the `direct_<32hex>_next-<base64url>` format while keeping existing cookies.
- `app/auth/facebook-callback/route.ts` resolves redirect destination from cookie first, embedded state second, and `/` fallback last, with same-origin path validation and a `next source` log.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (not run; redirect-only route change)
- [ ] `npm test` (not run; no relevant test harness for the OAuth callback round-trip)

## Notes

- Scoped ESLint passed for touched files.
- Browser OAuth validation must happen after deploy with a real Facebook reconnect from `/settings`.
