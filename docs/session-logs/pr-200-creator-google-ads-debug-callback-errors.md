# Session log: Google Ads OAuth callback error diagnostics

## PR

- **Number:** 200
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/200
- **Branch:** `creator/google-ads-debug-callback-errors`

## Summary

This debugging PR replaces the `undefined undefined: undefined` Google Ads API error path with a concrete fallback and adds structured callback/client logging so the next production OAuth failure exposes the real cause in Vercel logs.

## Why

Production OAuth callback fails with `google_ads_oauth_error=undefined+undefined%3A+undefined`.
The google-ads-api library throws pre-formatted error messages where all three template fields can be undefined.
This PR replaces the broken message with a useful fallback and adds error logging so the next failure shows the actual cause in Vercel logs.

## Scope / files

- `lib/google-ads/retry.ts` now detects the broken google-ads-api template message and replaces it with a fallback containing `httpStatus`, original error constructor name, and the first 200 chars of safe JSON details.
- `lib/google-ads/client.ts` now logs failed Google Ads client calls at `console.error` with label, attempt, constructor name, own keys, and safe-stringified error details.
- `app/api/google-ads/oauth/callback/route.ts` now logs callback failures with the failing step, error summary, top stack frames, refresh-token presence, and current customer id.
- `lib/google-ads/__tests__/retry.test.ts` covers the broken-template fallback.

## Validation

- [ ] `npx tsc --noEmit lib/google-ads/retry.ts lib/google-ads/client.ts app/api/google-ads/oauth/callback/route.ts` — command-form blocker: passing explicit files bypasses the repo path-alias/project setup and fails on `@/` imports plus raw dependency declarations. `npm run build` below runs project TypeScript successfully.
- [x] `npx eslint lib/google-ads/ app/api/google-ads/`
- [x] `node --experimental-strip-types --test 'lib/google-ads/__tests__/*.test.ts'`
- [x] `npm run build`

## Test instructions post-merge

1. Trigger Connect Google Ads from the Black Butter Records client page.
2. Check Vercel runtime logs for `[google-ads-oauth-callback] failure` entry.
3. The redirect URL should now contain a meaningful error string.

## Notes

- This PR intentionally does not fix the underlying Google Ads API failure; it only surfaces the real runtime error.
- No concurrency constants, TikTok files, shared root types, package files, or proxy files were changed.
