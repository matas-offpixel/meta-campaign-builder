# Session log

## PR

- **Number:** 816
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/816
- **Branch:** `cursor/tiktok-schedule-timezone`

## Summary

A start 18 minutes in the operator's future was rejected as past because we UTC-converted a naive datetime-local. Schedule times are now formatted in the advertiser `timezone` from `/advertiser/info/`. Preflight blocks a start that is already past or inside a 15-minute margin. Step 5 replaces a missing or stale start with a 30-minute-ahead default.

## Scope / files

- `lib/tiktok/write/schedule-time.ts` — conversion + margin
- `lib/tiktok/write/mapping.ts` / `preflight.ts` / `adgroup.ts` / `launch.ts` / `orchestrator.ts`
- `lib/tiktok/advertiser.ts` — `timezone` + `display_timezone` from `/advertiser/info/`
- `lib/tiktok-wizard/budget-schedule.ts` + Step 5 UX
- Tests for America/New_York conversion, past/margin preflight (zero writes), and end-time conversion

## Validation

- [x] `npm run build`
- [x] `npx eslint` on changed files
- [x] `npm test` — 4096 = 4080 passed + 13 failed + 3 skipped (pre-existing 13; +11 vs #815's 4085)

## Notes

- Docs source: Create an ad group, `schedule_start_time` / `schedule_end_time` labelled UTC+0 — https://ads.tiktok.com/marketing_api/docs?id=1739499616346114
- Advertiser field: `timezone` from AccountManagementApi `/advertiser/info/` — https://ads.tiktok.com/marketing_api/docs?id=1739593083610113. `display_timezone` is requested but not used for schedule strings.
- Live request `20260821193127B3D9008B64A624A0E816` rejected 0-offset UTC conversion. Margin: 15 minutes. UX lead: 30 minutes.
