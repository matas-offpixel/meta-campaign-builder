# Session log

## PR

- **Number:** 936
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/936
- **Branch:** `cursor/duplicate-must-choose-its-event`

## Summary

A Meta duplicate was inheriting the source event, so sixteen campaigns hung off Mall Grab and the two Live-armed Newcastle drafts skipped every tick. Duplicate and Relaunch now require an event (same modal as the plan library), Campaign Setup shows and can change the event, and a code/event mismatch names both sides. `settings.eventId` is the source of truth; the column follows on save. The twenty-eight are surfaced, not backfilled.

## Scope / files

- `lib/campaign-event.ts` — resolve, re-derive, mismatch copy
- `lib/db/drafts.ts` — `duplicateCampaign(id, userId, eventId)` required; list warnings from name + event_id (no `draft_json`)
- `components/library/event-pick-dialog.tsx` — shared plan/campaign picker
- `components/library/{plan-library,campaign-library,library-rows}.tsx`
- `components/steps/campaign-setup.tsx` — event selector + named mismatch
- `lib/wizard/event-context.ts` — JSON first
- `lib/db/campaign-automation-decisions.ts` — same resolver; `console.error` + Slack when carriers disagree
- `lib/db/events.ts` — `linkDraftToEvent` re-derives, optimistic lock, refuses column-only write
- `lib/plan/from-existing.ts` — overlay goes through `applyEventToCampaignSettings`
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` untouched

## Review round 2 — fixed

| Finding | File | Test that pins it |
|---|---|---|
| First bracket that is not a code (`[2027]`, three-date marker) was rewritten | `lib/campaign-event.ts` `isReplaceableEventCodePrefix` | `leaves a year prefix alone`; `leaves a three-date marker alone` |
| Null `event_code` wiped `campaignCode` and hid the mismatch | `applyEventToCampaignSettings` + `describeCodeEventMismatch` | `does not blank campaignCode when the event has no code` |
| Plan prepare-draft overlay set `eventId` without re-deriving the code | `lib/plan/from-existing.ts` + prepare-draft event fetch | `a prepare-draft clone onto a different event re-derives the code` |
| `loadCampaignList` pulled 156 full `draft_json` blobs | `lib/db/drafts.ts` — name + `event_id` + events join | `loadCampaignList does not pull draft_json`; 156 mismatch checks 0.65ms |
| `linkDraftToEvent` clobbered autosave, skipped re-derive, column-only on bad JSON | `lib/db/events.ts` | `linkDraftToEvent re-derives and refuses a column-only write` |
| Cron flipped precedence with no log | `campaign-automation-decisions.ts` `console.error` + `notify` | `the cron logs when event carriers disagree` |
| Two warnings joined with `??` | `joinEventWarnings` | `shows both when a draft has a code mismatch and a carrier mismatch` |
| `useFetchEvents()` could hide a wired event behind the 1000-row cap | `includeId` + context merge; "not in this list" not "No event linked" | Campaign Setup source pin |
| Freeze guard compared the working tree to `origin/main` | scoped to this branch name / `GITHUB_HEAD_REF` | `this branch does not touch evaluate/apply/gates/plan-workspace` |

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5616 pass, 4 skipped)

## Notes

- `ENABLE_OPTIMISATION_WRITES` unchanged. The loop stays armed.
- `ENABLE_OPTIMISATION_PAUSE_WRITES` not in this PR.
- No migration. No backfill. Matas repairs each of the twenty-eight.
- A draft whose code and event already agree is byte-identical after `applyEventToCampaignSettings`.
- Prod census (round 2): zero rows have both carriers set to different events. Four unnamed drafts have column set and JSON empty — `resolveDraftEventId` still falls back to the column. Precedence inversion is inert on merge.
- `loadCampaignList` timing: dropped `draft_json` rather than timing the fat query. Warning path on 156 names is 0.65ms locally. The list is seven scalars + `event_id` + one events join, the shape it was before this PR plus the index column.
