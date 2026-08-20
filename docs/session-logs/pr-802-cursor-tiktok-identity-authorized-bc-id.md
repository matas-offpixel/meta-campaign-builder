# Session log

## PR

- **Number:** 802
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/802
- **Branch:** `cursor/tiktok-identity-authorized-bc-id`

## Summary

#801 guessed `identity_bc_id` / `bc_id` / `business_center_id`. Production `/identity/get/` for advertiser 7639802149165301776 carries `identity_authorized_bc_id` instead, so extractIdentityBcId returned null on fa2efef and preflight blocked. Read that key first, keep the other three as fallbacks, and take BC ids from nested `bc_info` on `/bc/get/` so the five-BC fallback can match via `/bc/advertiser/get/`. Advertiser comparison is now number-tolerant.

## Scope / files

- `lib/tiktok/identity.ts` — candidate key + nested `bc_info` + numeric advertiser match
- Tests for the measured production row, nested BC list, preflight, and ad payload

## Validation

- [x] `npm run build`
- [x] `npm test` — 3966 = 3950 passed + 13 failed + 3 skipped (13 pre-existing)
- [x] eslint on changed files clean

## Notes

Diagnostic row-key dumps from #801 are unchanged. Budget preflight, killswitch, paused create, rollback, upload, audiences, and Meta are untouched.
