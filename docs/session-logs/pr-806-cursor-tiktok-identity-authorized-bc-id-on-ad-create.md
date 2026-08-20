# Session log

## PR

- **Number:** 806
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/806
- **Branch:** `cursor/tiktok-identity-authorized-bc-id-on-ad-create`

## Summary

`/ad/create/` was sending the Business Center id as `identity_bc_id` because TikTok's 40002 text says "Identity_bc_ID". That is prose. TikTok's own Marketing API documents `identity_authorized_bc_id` on the creative object. The value was already correct (AMAAD Projects `7629750024332378128` owns Ironworks). Send the documented field name and log the outgoing identity fields so the next failure shows what went over the wire.

## Scope / files

- `lib/tiktok/write/mapping.ts` — BC_AUTH_TT creative field is now `identity_authorized_bc_id`
- `lib/tiktok/write/ad.ts` — `console.error` of identity fields immediately before `/ad/create/`
- Tests in `write-mapping.test.ts` and `write-foundation.test.ts`

Did not change identity resolution (`lib/tiktok/identity.ts`), preflight, killswitch, paused create, rollback, idempotency, or Meta.

## Documentation

TikTok documents the field explicitly. Not a fallback.

- Preview (identity fields, required when `identity_type` is `BC_AUTH_TT`): https://business-api.tiktok.com/portal/docs?id=1739403070695426
- Official SDK `/ad/create/` creative model `AdcreateCreatives` lists `identity_authorized_bc_id` (no `identity_bc_id`): https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdcreateCreatives.md
- Official SDK `AdCreateBody` is only `advertiser_id`, `adgroup_id`, `creatives` — the BC id stays inside each creative, not at ad level: https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdCreateBody.md
- Ad Create portal page (SPA scrape did not expand creative fields): https://business-api.tiktok.com/portal/docs?id=1739953377508354

## Validation

- [x] focused write tests — 36 pass
- [x] eslint on changed files clean
- [x] `npm run build` clean (existing Remotion `config` warning only)
- [x] `npm test` — 3982 = 3966 passed + 13 failed + 3 skipped (+1 vs #804 follow-up 3981; same 13 pre-existing)

## Notes

Hypothesis 3 (task #143) — field at AD level rather than inside each creative — is contradicted by `AdCreateBody`. Left it on the creative.
