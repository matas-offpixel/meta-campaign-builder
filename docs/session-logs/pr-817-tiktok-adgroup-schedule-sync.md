# Session log template

## PR

- **Number:** 817
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/817
- **Branch:** `cursor/tiktok-adgroup-schedule-sync`

## Summary

Ad groups copied `scheduleStartAt` when first generated and never refreshed, so Step 6 edits updated a field nothing read at launch. Mapping now reads the campaign-level schedule (`read-through`); leftover ad-group `startAt` / `endAt` are tolerated on load and ignored on write. Preflight validates that same value.

## Scope / files

- `lib/tiktok/write/mapping.ts` — `tikTokWriteSchedule()` reads `budgetSchedule.scheduleStartAt` / `scheduleEndAt` only
- `lib/tiktok/write/preflight.ts` — start-time guard and budget floor use the same helper
- `lib/tiktok/write/adgroup.ts` — create log uses the same helper
- `lib/tiktok-wizard/ad-group-reconcile.ts` — new groups no longer snapshot the schedule
- `lib/tiktok-wizard/migrate-draft.ts` — older ad groups that still carry `startAt` / `endAt` load
- `components/tiktok-wizard/steps/assign-creatives.tsx` — display the draft schedule

## Validation

- [x] `npm run build`
- [x] `npx eslint` on changed files
- [x] `npm test` — 4101 = 4085 passed + 13 failed + 3 skipped (pre-existing 13; +5 vs #816's 4080)

## Notes

Approach: **read-through** (not propagate). Mapping, preflight, and the ad-group create log all use `tikTokWriteSchedule()`, which reads only `budgetSchedule.scheduleStartAt` / `scheduleEndAt`. Leftover ad-group `startAt` / `endAt` still load via `migrateTikTokDraft` and are ignored on write. #816 timezone conversion is unchanged.
