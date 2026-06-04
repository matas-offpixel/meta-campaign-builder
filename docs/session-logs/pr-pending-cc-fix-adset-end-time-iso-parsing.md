# Session log — fix adset end_time ISO parsing

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/fix-adset-end-time-iso-parsing`

## Summary

`toUnixTs` in `lib/meta/adset.ts` unconditionally appended `T00:00:00Z` to its input, assuming a `YYYY-MM-DD` date string. The wizard now stores `budgetSchedule.endDate` as an ISO datetime-local string (`YYYY-MM-DDTHH:mm`), so concatenation produced the invalid ISO `"2026-08-06T12:00T00:00:00Z"`. `new Date()` returned `NaN`, `JSON.stringify(NaN)` serialised to `null`, Meta dropped `end_time`, and all ad sets were created "Ongoing". Fixed by normalising the input before parsing, throwing on `NaN`, and adding a `console.error` in `buildAdSetPayload` so future schedule mismatches are immediately visible in Vercel logs.

Confirmed evidence: draft `eb8e6a17` had `endDate="2026-08-06T12:00"`; all 8 published ad sets showed "Ongoing" in Meta Ads Manager.

## Scope / files

- `lib/meta/adset.ts` — `toUnixTs` rewrite + schedule diagnostic log in `buildAdSetPayload`
- `lib/meta/__tests__/adset-time-conversion.test.ts` — 9 new regression tests

## Validation

- [x] `npx tsc --noEmit` — no new errors (pre-existing `.next/dev` and audience test errors unaffected)
- [x] `node --experimental-strip-types --test lib/meta/__tests__/adset-time-conversion.test.ts` — 9/9 pass

## Notes

- `startDate` has the same bug but Meta defaults `start_time` to "now" when absent, hiding it. The fix covers both paths.
- Timezone awareness (treating datetime-local as local rather than UTC) is a Phase 5 TODO, documented in the code comment.
