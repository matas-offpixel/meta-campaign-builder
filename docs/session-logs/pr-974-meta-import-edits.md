# Meta importer PR C — add audiences, change objective, change URLs

## PR

- **Number:** 974
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/974
- **Branch:** `cursor/meta-import-edits`

## Summary

The three edits the importer exists for (Matas, 23 Sept): move an imported
campaign from signup to on-sale by adding audiences, changing the objective,
and changing URLs. Every imported ad set now carries the id of the live ad
set it was read from and shows a quiet `imported · {id}` mark in Step 5.
Generate adds rows for new audiences without touching imported rows. An
account change after import blocks. An objective that needs a conversion
event blocks when no pixel is configured. A "set every creative" URL control
patches imported creatives. The importer and these edits still write nothing
to Meta; launch creates a new campaign.

## Scope / files

- `lib/types.ts`: `AdSetSuggestion.importedFromAdSetId`. Not `metaAdSetId`.
- `lib/meta/import/map.ts`: the only mapper change, which stamps `importedFromAdSetId: id`.
- `lib/wizard/adset-suggestions.ts`: a duplicated row drops the mark.
- `lib/wizard/import-edits.ts` (new) contains:
  - `mergeGeneratedWithImported`
  - `importedAccountProblem`
  - `objectivePixelProblem`, which calls `resolveOptimisationGoal` and `buildPromotedObject`
  - `setEveryCreativeDestinationUrl`
  - `isAbsoluteHttpUrl`
  - the badge and notice copy
- `lib/validation.ts`: the account blocker is in step 0; the pixel blocker is in step 1 for imported drafts.
- `components/steps/budget-schedule.tsx`: Generate goes through the merge, and rows get the badge.
- `components/steps/campaign-setup.tsx`, `components/plan/meta-drawer-details.tsx`, `components/wizard/wizard-shell.tsx`: the visible new-campaign notice on the objective card.
- `components/steps/creatives.tsx`: the set-every-creative destination URL control.
- `lib/wizard/__tests__/import-edits.test.ts` (new): 18 tests.

## Pixel stats-by-event: what the API says

This covers read-only GETs on Graph v21.0 against `act_1967530076312`.

- `GET /{pixel}/stats?aggregation=event&start_time=…` returns hourly buckets of event name and count. For example, Ironworks `33782234934753151` returned `{"start_time":"2026-09-17T16:00:00+0100","aggregation":"event","data":[{"value":"PageView","count":236},…,{"value":"Purchase","count":10}]}`.
- **Retention is about 28 days.** Six-hour windows on Ironworks have data at 18, 21, 24, 27 and 28 days back, and 0 buckets at 29, 30, 60, 90 and 180 days.
- **The response paginates at 24 hourly buckets.** A one-day query returns 24 buckets plus `paging.next`, so 28 days is about 28 pages.
- An older pixel returns nothing. Human Traffic Live `4230447737190987` has `last_fired_time` 2025-12-11 and returns 0 buckets for 30, 90 and 365 days, and for 2025-12-08 to 12-14.
- `adspixels.last_fired_time` is one timestamp per pixel, not per event.

So the API can say "fired in the last ~28 days", not "has ever fired". It would also block the exact case this feature is for: in a signup phase, Purchase has not fired yet. That check was not shipped. What ships is the weaker check: `buildPromotedObject` returning `undefined` for an objective that needs an event blocks with "{Objective} optimises for a pixel conversion event: no pixel configured for this ad account." It proves a pixel is configured and nothing more.

## Validation

- [x] `npm test`: 6242 tests, 0 failures
- [x] `npm run build`
- [x] `npx tsc --noEmit`: no errors in touched files (336 existing errors in asset-queue and bulk-website tests)
- [x] eslint on touched files: 0 errors

## Notes

- The pixel blocker is scoped to imported drafts. Non-imported new drafts have the same silent gap, where the launch sends no `promoted_object`. That is a follow-up.
- The account-change blocker blocks rather than re-reading availability. It fires only when imported `custom_group` rows exist.
