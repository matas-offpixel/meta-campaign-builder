# Session log

## PR

- **Number:** 936
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/936
- **Branch:** `cursor/duplicate-must-choose-its-event`

## Summary

A Meta duplicate was inheriting the source event, so sixteen campaigns hung off Mall Grab and the two Live-armed Newcastle drafts skipped every tick. Duplicate and Relaunch now require an event (same modal as the plan library), Campaign Setup shows and can change the event, and a code/event mismatch names both sides. `settings.eventId` is the source of truth; the column follows on save. The twenty-eight are surfaced, not backfilled.

## Scope / files

- `lib/campaign-event.ts` — resolve, re-derive, mismatch copy
- `lib/db/drafts.ts` — `duplicateCampaign(id, userId, eventId)` required; list warnings
- `components/library/event-pick-dialog.tsx` — shared plan/campaign picker
- `components/library/{plan-library,campaign-library,library-rows}.tsx`
- `components/steps/campaign-setup.tsx` — event selector + named mismatch
- `lib/wizard/event-context.ts` — JSON first
- `lib/db/campaign-automation-decisions.ts` — same resolver
- `lib/db/events.ts` — `linkDraftToEvent` writes both carriers
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test`

## Notes

- `ENABLE_OPTIMISATION_WRITES` unchanged. The loop stays armed.
- `ENABLE_OPTIMISATION_PAUSE_WRITES` not in this PR.
- No migration. No backfill. Matas repairs each of the twenty-eight.
- A draft whose code and event already agree is byte-identical after `applyEventToCampaignSettings`.
