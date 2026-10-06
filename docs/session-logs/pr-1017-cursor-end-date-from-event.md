# Session log

## PR

- **Number:** 1017
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1017
- **Branch:** `cursor/end-date-from-event`

## Summary

The Schedule card's end date stayed empty because it read a one-shot event fetch that does not follow the draft. It now uses the same selected event as the Campaign step. An empty end date, or one still derived from the previous event, becomes that event's `T23:59`. A date the operator typed is left alone.

## Scope / files

- `lib/wizard/event-end-date.ts` — derive, migrate, and display the end date
- `lib/wizard/use-event-context.tsx` — selected event follows `settings.eventId`
- `components/steps/budget-schedule.tsx` — prefilled end date, no-event note, sticky "Use event date" only when they differ
- `components/wizard/wizard-shell.tsx` and `components/plan/meta-drawer.tsx` — provider sees the live event id
- `lib/meta/import/save.ts` — an import with an event and no Meta end date takes the event end
- `lib/autosave.ts` — `endDateSource` on load when the event date is known

## Validation

- [x] `npm run build` (TypeScript finished inside the build)
- [x] `npm test` (6635 pass, 4 skipped, vitest 6 pass)

## Notes

`useWizardEventContext().event` is still the one-shot `/api/wizard/event-context` read, used for client defaults. The Schedule card and the Campaign EVENT block both read `selectedEvent`, which is `useFetchEvents(settings.eventId)`. On the plan drawer that provider was not mounted, so the hook was the empty default. Lifetime with no event still blocks on "Lifetime budgets need an end date."
