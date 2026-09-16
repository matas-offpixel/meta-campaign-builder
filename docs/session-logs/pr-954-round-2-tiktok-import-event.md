# Session log — TikTok import event, round 2

## PR

- **Number:** 954
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/954
- **Branch:** `cursor/tiktok-import-event`

## Summary

Round 1 attached an event on import so relaunch could leave preflight. Round 2
fixes how the replacement writes, and the path Matas will actually use.

Review schedule persists on blur, not per-segment `change` (task #139). Local
`startDraft` / `endDraft` drive the inputs so a write in flight never disables
them or clobbers the typed value. `PATCH /api/tiktok/drafts/[id]` is extracted
and tested: ownership is checked against the *stored* `clientId`, a body that
also changes `clientId` is rejected, and attach goes through
`attachTikTokImportEvent`. An unlinked TikTok account returns its own message on
picker and save instead of blaming `event_id`. The case-sensitivity grep is
gone; the lowercase `[irw0001]` test stands alone. The zero-issues test pins
both clocks — import/heal vs launch-evaluation. Dead
`requestTikTokReviewScheduleHeal` is deleted.

## Scope / files

- `lib/tiktok-wizard/review-schedule.ts` — persist on blur; field stays enabled
- `components/tiktok-wizard/steps/review-launch.tsx` — local state, blur write
- `lib/tiktok-wizard/patch-draft.ts` — extracted PATCH; stored client; helper
- `app/api/tiktok/drafts/[id]/route.ts` — thin wrap
- `lib/tiktok/import/save.ts` — unlinked 400 before TikTok; picker names it
- `components/tiktok/tiktok-import-picker.tsx` — message where the select was
- `lib/tiktok-wizard/budget-schedule.ts` — heal helper deleted
- Tests: PATCH trio, unlinked picker+save, blur pin, both clocks

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` — 6002 pass, 0 fail, 4 skipped

## Notes

- Did not restore auto-heal. `lib/tiktok/write/**` still read-only. `picker.ts`,
  `map.ts`, `readers.ts`, both captured fixtures byte-identical. No migration,
  no backfill, idempotency key unchanged. Round-1 save/suggestion/column/schedule
  assertions unmodified except the dropped `.toUpperCase()` grep.
- Prompt dump `pr-954-round-2-2026-09-16.md` is not this log.
