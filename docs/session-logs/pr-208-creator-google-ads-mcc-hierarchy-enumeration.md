# Session Log: Google Ads MCC Hierarchy

## PR
- Number: #208
- URL: https://github.com/matas-offpixel/meta-campaign-builder/pull/208
- Branch: `creator/google-ads-mcc-hierarchy-enumeration`

## Why
After PR #207, OAuth connect only inserts ONE row in google_ads_accounts (the first directly-accessible customer).
Real agencies have an MCC with many linked sub-accounts where the agency user isn't directly listed on each sub-account.
This PR enumerates the full MCC hierarchy via GAQL customer_client query and upserts one row per ENABLED sub-account.

## Changes
- OAuth callback now enumerates directly accessible managers, upserts enabled hierarchy rows, stores shared credentials per row, and redirects with `count=N`.
- Added `lib/google-ads/customer-hierarchy.ts` plus focused tests for manager, standalone, cancelled, test, and duplicate customer cases.
- Added migration 063 because the repo schema only had `(user_id, account_name)` uniqueness, not `(user_id, google_customer_id)`.

## Verified
- Local build green
- All tests pass
- Pending production verification: connect MCC 333-703-8088 and confirm LWE, Off/Pixel, Black Butter all appear in the client picker

## Validation
- [x] `npx tsc --noEmit`
- [x] `npx eslint lib/google-ads/ app/api/google-ads/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes
- Kept the PR #207 REST path; no gRPC/google-ads-api calls were reintroduced.
- Did not touch concurrency constants, credential RPCs, or OAuth state/cookie flow.
