# Session log

## PR

- **Number:** 906
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/906
- **Branch:** `cursor/plan-v2-live-fix-round3`

## Summary

Live-walk round 3. Placeholders leave the D.O.D rail so `now · gen sale passed Fri 4 Sep` prints; the usual split uses ticks at 80 and 95 with a hairline 2px above the bar; the last date right-aligns with `translateX(-100%)`; dashed asset slots are 96px and show the filename; until reads resolve the face is a 35% ink skeleton with no state word.

## Scope / files

- `lib/viz/window-bar.ts` — `windowMissingMomentsLine`; placeholders stay off the rail
- `components/viz/window-bar.tsx` — joined `now` label always prints; end label `translateX(-100%)`
- `lib/viz/split-bar.ts` — `splitOutlineBoundaries` (80, 95 for 80·15·5)
- `components/viz/split-bar.tsx` — ticks + hairline outside `overflow-hidden`
- `components/viz/asset-strip.tsx` — dashed slot `min-w-24`, filename in `micro`
- `lib/plan/adjust-face.ts` / `lib/plan/launch-face.ts` — `reads: undefined` is the pending skeleton
- `components/plan/{canvas-adjust,canvas-channels,plan-workspace}.tsx`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5334 pass, 4 skipped)

## Notes

Do not merge. Screenshots from `next start` of this branch are in `docs/session-logs/assets/plan-v2-round3/`. Production walk was `main` `8ea9737`.
