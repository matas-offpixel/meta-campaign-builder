# Session log

## PR

- **Number:** 1170
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1170
- **Branch:** `cursor/promoter-candidates-show`

## Summary

Puzzle's Instagram reels were stored on the client and then dropped, because the card kept only candidates whose artist id was on the lineup. The footage group now shows those tiles, and Add imports them as promoter footage for the event. The event page takes one server instant for its dates, so the releases timeline no longer paints the frame's "Today · 7 Nov" and the day text matches on server and client.

## Scope / files

- `lib/db/creative-lab.ts` — keep client-scoped candidates with no artist
- `components/dashboard/events/creative-lab/clips.tsx` — tiles in the promoter group; the empty state stays only when there are none
- `lib/releases/london.ts`, `lib/releases/view.ts`, `lib/dashboard/format.ts`, `components/dashboard/asset-bank/live.tsx`, `components/dashboard/events/event-detail.tsx`, `app/(dashboard)/events/[id]/page.tsx` — one server instant, London day text with a normal space
- Tests for the card load, the promoter import, the two tiles, and the today label

## Validation

- [x] `node --test` for the card, import, and london date tests
- [x] vitest for the Puzzle group render
- [ ] `npm run build` (CI)

## Notes

No migration. CLW1 stays the empty Puzzle group, so no frame moved. CLW1b was not added.
