# Session log — PR #359

## PR

- **Number:** 359
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/359
- **Branch:** `creator/audience-user-rate-limit-detection`

## Summary

Extended Meta rate-limit detection beyond **#80004** to include **#17** (user token), **#4** (application), subcode **2446079**, and message matches for “User request limit” / “Application request limit”. Introduced internal **`coverGenericRateLimitBody(scope)`** and **`audienceSourceRateLimitBody(err?)`** with scope-aware copy (`user account` / `ad account` / `app`). **80004** is classified before bare **code 4** so Meta’s **code 4 + subcode 80004** pairs still read as ad-account limits.

## Scope / files

- `lib/audiences/meta-rate-limit.ts`
- `lib/audiences/__tests__/meta-rate-limit.test.ts`
- Audience source routes + bulk preview/create — pass `err` into `audienceSourceRateLimitBody(err)`

## Validation

- [x] `npm run build`
- [x] `npm test`
- [x] `npx eslint` (scoped)
