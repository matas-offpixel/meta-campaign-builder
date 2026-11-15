# Session log

## PR

- **Number:** 1058
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1058
- **Branch:** `cursor/pages-reduce-data`

## Summary

The Facebook Page picker failed for the operator token because `/me/accounts` asked for 200 pages at a time with picture and Instagram fields. Meta answered code 1 ("reduce the amount of data", and once only "An unknown error occurred"). The walk now starts at 100, halves to 50 then 25 on that error, and keeps pages already fetched.

## Scope / files

- `lib/meta/pages-list-response.ts` — page size 100, `walkPageEdge`, personal time budget
- `lib/meta/client.ts` — `fetchPagedPageEdge` uses the existing reduce-data check (phrase or code 1 / subcode 99) and one Graph attempt
- `app/api/meta/pages/route.ts` — `maxDuration = 300` so the 240s personal budget sits inside the function

## Validation

- [x] `npx tsc --noEmit` (no errors in touched files)
- [x] `npm run build`
- [x] `npm test` (7312 pass, 4 skipped, plus 8 vitest)
- Read-only `/me/accounts` with the operator token: 835 pages, 158s, not truncated

## Notes

"An unknown error occurred" is Meta's `error.message` for code 1. The reduce-data phrase is often only in `error_user_msg` (subcode 99), and the pages route logged `Error.message` alone. The function had no `maxDuration` and ran 30–130s because Graph retries code 1 five times before the edge can shrink. It was not a platform timeout: the catch logged Meta's message.
