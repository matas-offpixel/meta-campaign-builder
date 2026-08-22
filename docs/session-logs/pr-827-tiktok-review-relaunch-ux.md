# Session log

## PR

- **Number:** 827
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/827
- **Branch:** `cursor/tiktok-review-relaunch-ux`

## Summary

Published TikTok drafts only offered a disabled Launch button on Review. Review now offers the same `duplicateTikTokDraft` Relaunch as the library. Schedule heal uses the advertiser timezone and the same 15-minute threshold as preflight, Review remounts re-heal the T0+15m dead zone, and a valid future start survives library Duplicate.

## Scope / files

- `lib/tiktok-wizard/budget-schedule.ts` — stale = `< now + margin`; heal wall clock in advertiser TZ; `applyTikTokScheduleHeal`
- `lib/tiktok/write/schedule-time.ts` — `formatDatetimeLocalInTimeZone`
- `lib/tiktok-wizard/library.ts` — heal only when the original start is stale; keep a valid future start
- `components/tiktok-wizard/steps/review-launch.tsx` — Review-mount heal; hide leftover surfaces on published drafts; member names on collapsed blockers; copy `readWorkingDraft()`
- `components/tiktok-wizard/wizard-shell.tsx` — `readWorkingDraft`
- `components/tiktok-wizard/steps/budget-schedule.tsx` — pass advertiser timezone into the Step 5 heal
- tests in `library.test.ts`, `budget-schedule.test.ts`

## Validation

- [x] TypeScript via `npm run build` (Finished TypeScript in 14.9s)
- [x] `npm run build` — succeeded (Next.js 16.2.1 Turbopack; pre-existing remotion `config` warning only)
- [x] `npx eslint` on changed files — clean
- [x] `npm test` — 4170 tests, 4154 pass, **13 fail** (pre-existing, unchanged), 3 skipped

## Notes

- Stale start is the same gate as launch preflight (`now + TIKTOK_SCHEDULE_START_MARGIN_MS`) in `accountSetup.timezone`.
- Duplicate at T0 + Review heal at T0+20m is covered so the 15-minute dead zone cannot come back.
- Tests pin `Pacific/Auckland` (or `Atlantic/Azores` if the runtime already is Auckland), not `Intl.DateTimeFormat().resolvedOptions().timeZone`.
