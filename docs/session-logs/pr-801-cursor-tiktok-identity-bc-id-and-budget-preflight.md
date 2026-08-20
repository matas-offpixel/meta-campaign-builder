# Session log

## PR

- **Number:** 801
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/801
- **Branch:** `cursor/tiktok-identity-bc-id-and-budget-preflight`

## Summary

First live TikTok launch failed at ad create: BC_AUTH_TT identities were sent without `identity_bc_id`, and a £25 daily budget passed campaign/ad-group create before TikTok rejected it. Log raw `/identity/get/` row keys, extract a BC id from `identity_bc_id` / `bc_id` / `business_center_id` (or `/bc/get/` + `/bc/advertiser/get/`), persist it on the draft, and send it only for BC_AUTH_TT. GBP daily minimum is now 50 in preflight so a sub-£50 budget never creates a campaign that has to be rolled back.

## Scope / files

- Identity parse + BC fallback (`lib/tiktok/identity.ts`)
- Draft `identityBcId`, account-setup persist, launch hydrate
- Ad payload `identity_bc_id` + GBP 50 preflight (`mapping.ts`, `preflight.ts`)

## Validation

- [x] `npm run build`
- [x] `npm test` — 3959 = 3943 passed + 13 failed + 3 skipped (13 pre-existing)
- [x] eslint on changed files: 0 errors (pre-existing hooks warning on account-setup)

## Notes

Did not change OFFPIXEL_TIKTOK_WRITES_ENABLED, paused create, rollback, upload, genre-presets, audience fetchers, or Meta.
