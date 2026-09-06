# Session log

## PR

- **Number:** 905
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/905
- **Branch:** `cursor/plan-v2-live-fix-round2`

## Summary

Live-walk round 2. The page chrome is the event name, the rail keeps the last date and refuses to join `now` with a placeholder, the empty purchase chip is `£—` plus a sentence, the Meta row reads the phase unit, the sparkline sits under the band, asset filenames stop truncating to three letters, the derive control is a word in the TikTok/Google ⓘ, the usual outline sits 2px above the split, budget is one `£40` token, and the list fold says `you can launch` when blockers span adapters.

## Scope / files

- `lib/plan/plan-name.ts` — `planPageTitle` is the event name or nothing
- `lib/viz/window-bar.ts` — placeholders never join `now`; last mark right-aligns
- `lib/plan/adjust-face.ts` — empty-chip sentence `Meta says · no purchases yet`
- `lib/plan/list.ts` — fold is per-adapter only when one adapter holds every blocker
- `lib/viz/split-bar.ts` — `splitOutlineRects` for usual 80·15·5
- `lib/viz/asset-strip.ts` — filename ellipsis after 24
- `components/plan/{canvas-adjust,canvas-channels,canvas-budget,plan-workspace}.tsx`
- `components/viz/{window-bar,metric-chip,split-bar,asset-strip,channel-row}.tsx`
- `app/(dashboard)/plan/[id]/page.tsx` — PageHeader uses `planPageTitle`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5332 pass, 4 skipped)

## Notes

Do not merge. Production walk was `main` `500786b`. I walk production again after merge.
