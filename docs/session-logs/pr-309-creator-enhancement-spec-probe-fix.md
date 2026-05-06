# Session log — creator/enhancement-spec-probe-fix

## PR

- **Number:** 309
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/309
- **Branch:** `creator/enhancement-spec-probe-fix`

## Summary

Fixes the Meta enhancement probe so per-ad Graph reads use real Ad fields (`contextual_multi_ads`, `multi_advertiser_ads`), never abort the response on a bad per-ad call (errors bucketed under `__error:…__`), and expose `errors_per_phase` for visibility. Creative-level contextual multi-advertiser enroll status continues to aggregate via existing `degrees_of_freedom_spec` on the main `/ads` payload.

## Scope / files

- `app/api/admin/meta-enhancement-probe/route.ts`

## Validation

- [x] `npx eslint app/api/admin/meta-enhancement-probe/route.ts`
- [x] `npm run build`
- [ ] Local curl for 4theFans client UUID returns 200 with non-empty `distinct_features` (may have `errors_per_phase.ad_level_fetch > 0`)

## Notes

Ads-list failures still return 502 with `errors_per_phase.ads_list: 1`; successful responses include `errors_per_phase.ads_list: 0`.
