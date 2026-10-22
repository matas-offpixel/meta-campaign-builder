# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/tiktok-pixel-server-events`

## Summary

The TikTok optimisation-event dropdown now includes server events that `/pixel/list/` omits. Puzzle's Submit Form is `FORM` on `/pixel/event/stats/` (7 server events, 0 browser). A list row with a blank `optimization_event` is mapped only through TikTok's documented conversion-event codes, including Submit Form → `FORM` and Complete Registration → `ON_WEB_REGISTER`. Deprecated rows are still dropped.

## Scope / files

- `lib/tiktok/pixel.ts`
- `lib/tiktok/__tests__/pixel.test.ts`
- `lib/tiktok/__tests__/captured-puzzle-pixel-2026-10-22.ts`

## Validation

- [x] `npx tsc --noEmit` — no errors in the touched files (the project has pre-existing errors in unrelated Jest route tests)
- [x] `npx eslint` on the touched files
- [x] `npm test` — 7409 pass, 0 fail, plus 8 library-row tests
- [x] `npm run build` (compiled and typechecked; a gitignored local `scripts/out/gds-groups.mts` had to be moved aside first because Next typechecks it)

## Notes

`/pixel/list/` for pixel `7691763173556371474` returned PAGE_VIEW (null `optimization_event`), INITIATE_ORDER, SHOPPING, LANDING_PAGE_VIEW, ENGAGED_SESSION. No source or setup fields, and no Lead row. `/pixel/event/stats/` is the read that includes the server event.
