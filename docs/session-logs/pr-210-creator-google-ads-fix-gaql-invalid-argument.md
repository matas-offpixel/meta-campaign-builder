# Session Log: Google Ads GAQL Invalid Argument

## PR
- Number: #210
- URL: https://github.com/matas-offpixel/meta-campaign-builder/pull/210
- Branch: `creator/google-ads-fix-gaql-invalid-argument`

## Why
Production Campaigns tab → Google Ads returned "Request contains an invalid argument."
Most likely cause: GAQL `IN ('SEARCH', 'VIDEO')` should be `IN (SEARCH, VIDEO)` (unquoted enums) for Google Ads REST API.
Adds raw-error fieldViolations logging for future diagnosis.

## Changes
- Changed Google Ads campaign insights GAQL to a compact single-line query with unquoted enum values.
- Added `YYYY-MM-DD` guards for `window.since` and `window.until` before issuing GAQL.
- Added raw `INVALID_ARGUMENT` details logging for Google Ads REST error responses.
- Added tests for unquoted enum GAQL and invalid date rejection.

## Verified
- Local build green
- Tests pass
- Pending production verification: open BB26-KAYODE event → Campaigns → Google Ads, should now show [BB26-KAYODE] YT Views with live data

## Validation
- [x] `npx tsc --noEmit`
- [x] `npx eslint lib/google-ads/ app/api/reporting/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes
- Kept the PR #207 REST adapter path.
- No OAuth, credentials, dependencies, migrations, or concurrency constants changed.
