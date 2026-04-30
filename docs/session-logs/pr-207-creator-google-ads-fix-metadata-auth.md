# Session log: Google Ads explicit OAuth auth

## PR

- **Number:** 207
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/207
- **Branch:** `creator/google-ads-fix-metadata-auth`

## Summary

Forces Google Ads API calls through an explicit refresh-token-backed OAuth2 client so Vercel never falls through to Google Application Default Credentials or the GCP metadata server during OAuth callback customer discovery.

## Why

Production OAuth callback was failing with "undefined undefined: undefined" because
google-ads-api v23 falls through to GCP Application Default Credentials when no
explicit OAuth2 client is passed. ADC lookup hits the metadata server, which doesn't
exist on Vercel, and the auth promise rejects with UNKNOWN — surfacing as a
malformed gRPC error.

This PR forces explicit OAuth2 client usage in the Google Ads client wrapper so the
refresh token is always honoured and ADC is never attempted.

## Scope / files

- `lib/google-ads/client.ts` keeps the same wrapper methods but replaces the google-ads-api gRPC call path with Google Ads REST calls authenticated by an explicit `OAuth2Client` seeded with the user's refresh token.
- `lib/google-ads/__tests__/client-auth.test.ts` verifies both `query()` and `listAccessibleCustomers()` call `setCredentials({ refresh_token })` and send bearer auth to Google Ads REST endpoints.

## Investigation

- Installed package is `google-ads-api@23.0.0`.
- v23 still documents `listAccessibleCustomers(refreshToken)` and `Customer({ refresh_token })`.
- Source inspection showed `google-ads-api` creates generated gRPC clients with `sslCreds`, but the generated `google-ads-node` client still constructs a `GoogleAuth` instance and calls `auth.getUniverseDomain()` during stub creation. With no explicit `authClient` passed to that generated client, gax can still attempt ADC metadata lookup before using the combined channel credentials.
- Chose Approach A by moving our wrapper to explicit OAuth2-backed REST calls rather than version-pinning to v22. The public wrapper remains stable for existing callers.

## Verified

- Local build green
- Tests pass
- Pending production verification post-merge

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint lib/google-ads/ app/api/google-ads/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Notes

- Did not touch retry classifier logic, concurrency constants, OAuth callback flow, logging, TikTok files, package files, root shared types, or `proxy.ts`.
- No dependencies were added; `google-auth-library` is already a dependency of `google-ads-api@23.0.0`.
