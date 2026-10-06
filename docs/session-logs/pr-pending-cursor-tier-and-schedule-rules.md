# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/tier-and-schedule-rules`

## Summary

Generate gives a Secondary row only to custom-audience ad sets; interest audiences take Primary, or every location when Primary is not tagged. Selecting an event sets the start to the next quarter hour and the end to the next phase (presale, then general sale, then event day). A typed date stays put. Launch sends the same name Step 5 shows.

## Scope / files

- `lib/wizard/generate-adset-suggestions.ts` — primary-only slice for `interest_group` and `blank`
- `components/steps/budget-schedule.tsx` — helper copy, phase note, phase menu
- `lib/wizard/event-end-date.ts` — `nextCampaignPhaseEnd`, `derivedStart`, pinned `endDatePhase`, `startDateSource`
- `lib/wizard/use-event-context.tsx`, `components/wizard/wizard-shell.tsx`, `lib/meta/import/save.ts` — apply on event selection
- `app/api/events/route.ts`, `lib/hooks/useEvents.ts`, `lib/meta/import/event.ts` — `presale_at` and `general_sale_at` (event-context already reads the row via `select *`)
- `lib/meta/adset.ts` — payload name is `adSetDisplayName`
- `lib/meta/budget-launch.ts`, `components/steps/review-launch.tsx` — Review names the phase

## Validation

- [x] `npm test` — 6666 tests, 6662 pass, 4 skipped, 0 fail; vitest 6 pass
- [x] `npm run build`
- [x] Schedule card on a throwaway draft attached to Girls Don't Sync (presale 7 Oct 2026): start 06/10/2026 18:45, end 07/10/2026 12:00, note "Ends at presale (7 Oct)". Clone deleted.

## Notes

TikTok and Google drawers were not changed. They should follow this start/end rule if the same schedule is wanted there. The plan canvas still writes its own intent window; the Meta wizard Schedule card follows the event once `settings.eventId` is set.
