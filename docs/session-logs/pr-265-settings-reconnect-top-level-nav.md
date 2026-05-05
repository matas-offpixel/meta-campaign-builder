## PR

- **Number:** 265
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/265
- **Branch:** `creator/settings-reconnect-top-level-nav`

## Summary

Facebook reconnect from Settings now uses a same-window OAuth navigation instead of a popup and token polling loop, matching the direct `/api/auth/facebook-start?next=/settings` flow that returns naturally to `/settings`.

## Scope / files

- `components/settings/connection-card.tsx` removes the Facebook popup window and `/api/auth/facebook-token` polling from reconnect.
- Facebook reconnect keeps the brief busy state, then assigns `window.location.href` to the existing `connection.reconnectHref`.
- TikTok and Google Ads reconnect links remain unchanged.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (not run; single client component behavior change)
- [ ] `npm test` (not run; no focused test harness for browser OAuth navigation)

## Notes

- Scoped ESLint passed for `components/settings/connection-card.tsx`.
- Browser validation must happen after deploy with the real Facebook OAuth round-trip from `/settings`.
- `/share/report/i6MRF2-I789FSxdY` was not changed by this PR.
