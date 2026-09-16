# Session log template

Copy to `docs/session-logs/pr-{number}-{branch-slug}.md` (use `pr-pending-{branch-slug}.md` until the PR exists).

## PR

- **Number:** 954
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/954
- **Branch:** `cursor/tiktok-import-event`

## Summary

Imported TikTok drafts never set `eventId`, so every one failed launch
preflight on the first check. The operator now picks an event (bracketed
campaign-name code is a case-sensitive default, never a save). `POST
/api/tiktok/campaigns/import` requires `eventId` on the carry path, verifies
it belongs to the resolved client, and writes it to both `state.eventId`
and `tiktok_campaign_drafts.event_id`. Existing drafts get the same select
on the standalone page. Review no longer silently heals a stale start —
start and end are editable there, with `schedule-start-soon` on the start
field.

## Scope / files

- `lib/tiktok/import/event.ts` — suggest / parse / ownership / attach
- `lib/tiktok/import/save.ts` — extracted POST handler; 400 before write
- `app/api/tiktok/campaigns/import/route.ts` — thin wrap
- `components/tiktok/tiktok-import-event-select.tsx` — shared select
- `components/tiktok/tiktok-draft-event-select.tsx` — standalone attach
- `components/tiktok/tiktok-import-picker.tsx` — event select + blocked save
- `components/tiktok-wizard/wizard-shell.tsx` — banner when `eventId` missing
- `components/tiktok-wizard/steps/review-launch.tsx` — editable schedule, no heal
- `app/api/tiktok/drafts/[id]/route.ts` — PATCH ownership check
- Tests: suggestion cases, case-sensitivity, 400s, saved `event_id`,
  `7f93de68` capture + event + future start → zero preflight issues

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 5994 pass, 0 fail, 4 skipped

## Notes

- Did not widen `tiktok_write_idempotency`. Did not change `lib/tiktok/write/**`
  except reading preflight output. No migration, no SQL backfill of the two
  existing drafts — the operator confirms `[IRW0001]` in two clicks.
