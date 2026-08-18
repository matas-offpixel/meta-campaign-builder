## PR

- **Number:** 782
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/782
- **Branch:** `cursor/refresh-active-creatives-public-route`

## Summary

Add middleware public-route carve-out for `/api/internal/refresh-active-creatives` so Bearer `CRON_SECRET` curls reach the handler instead of 307'ing to `/login` (same failure mode as PR #407/#470/#479). Route already enforces CRON_SECRET-or-session itself.

## Scope / files

- `lib/auth/public-routes.ts` — one carve-out + comment next to `scan-enhancement-flags`

## Validation

- [ ] Bearer curl to `/api/internal/refresh-active-creatives` returns handler auth response (not "Redirecting..." HTML)

## Notes

- Nothing else changed.
