# Session log

## PR

- **Number:** 1006
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1006
- **Branch:** `cursor/registration-as-sales`

## Summary

Signup campaigns launch as `OUTCOME_SALES` with `COMPLETE_REGISTRATION` on the ad set, so a campaign can be duplicated in Ads Manager and the event changed to Purchase. The draft still says Registration. Campaigns already live as `OUTCOME_LEADS` are unchanged.

## Scope / files

- `lib/meta/campaign.ts` — `OBJECTIVE_MAP.registration` is `OUTCOME_SALES`. Importer majority-votes the ad set event.
- `lib/meta/import/map.ts` — mixed events named on `dropped[]`. `OUTCOME_LEADS` stays registration.
- `lib/meta/advantage-plus-compat.ts` — Advantage+ offered for registration.
- `lib/dashboard/funnel-stage-classifier.ts`, `lib/intelligence/objective-metrics.ts` — signup vs sales follows `custom_event_type`.
- `lib/meta/creative-insights.ts`, `lib/db/creative-insight-snapshots.ts` — event stored in existing `raw_insights`.
- `lib/meta/campaign-ledger.ts` — relaunch of an old registration draft mints `OUTCOME_SALES` instead of 409.
- Launch summary line names the Meta objective that was sent.

## Validation

- [x] `npm test` — 6535 tests, 6532 pass, 0 fail, 3 skipped
- [x] `npm run build`
- Live read-back (paused, then deleted): campaign `120250186568200453`, ad set `120250186568390453` on `act_968594768066330`. `optimization_goal` `OFFSITE_CONVERSIONS`, `destination_type` `WEBSITE`, `promoted_object.custom_event_type` `COMPLETE_REGISTRATION`, campaign objective `OUTCOME_SALES`.

## Notes

No migration. Purchase, traffic, awareness, and engagement goldens unchanged. Registration golden changes only `objective`.
