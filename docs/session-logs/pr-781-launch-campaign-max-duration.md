## PR

- **Number:** 781
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/781
- **Branch:** `cursor/launch-campaign-max-duration`

## Summary

Raise `maxDuration` on launch-scale Meta routes so large launches no longer die at the project default (2026-08-18: 9×10 ads 504'd mid-run with `FUNCTION_INVOCATION_TIMEOUT`, client showed non-JSON parse error).

## Scope / files

- `app/api/meta/launch-campaign/route.ts` — `export const maxDuration = 800`
- `app/api/meta/create-creatives-and-ads/route.ts` — same (was also missing)
- Checked: `bulk-attach-ads` already has 600; audience bulk routes already have 300; left alone

## Validation

- [x] Grep `app/api/meta/` for launch-scale routes and existing `maxDuration`
- [ ] Deploy smoke: large launch completes without FUNCTION_INVOCATION_TIMEOUT

## Notes

- Reproducer 2026-08-18: client `"Unexpected token 'A' … is not valid JSON"` came from parsing Vercel's plain-text 504 page.
