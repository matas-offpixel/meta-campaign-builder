# Session log

## PR

- **Number:** 904
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/904
- **Branch:** `cursor/plan-v2-live-fix-launch-list`

## Summary

Live-walk fix for the draft canvas (Jamie Jones / frame A-series) and `/plans`. The header is `events.name` verbatim, destination and target edit live in details, budget chrome is words not a pill, one preflight blocker count feeds the list fold / channel row / launch button, row facts singularise, a past-show draft is `done`, and a running plan with a junk end still draws a solid since-launch pace bar.

## Scope / files

- `lib/plan/plan-name.ts` — header is the event name; stored title stays in the ⓘ
- `lib/plan/launch-face.ts` — `tickets at host`; identity tip accepts `planTitle`
- `lib/plan/preflight.ts` — `collectPlanPreflightBlockers` / `planPreflightBlockerCount`
- `lib/plan/list.ts` — past-show draft → `done`; dashed track = drafts only; fold count = all blockers
- `lib/viz/channel-row.ts` — `1 creative · 1 ad set`
- `components/plan/{canvas-header,canvas-budget,canvas-target,canvas-channels,plan-workspace}.tsx`
- `components/viz/{event-thumb,metric-chip,window-bar,channel-row}.tsx` — no initials, `£0.63`, `end · now`, `in 2h`, no status dots
- `components/library/library-rows.tsx` — J24 fill despite junk end; dashed for drafts only
- Tests: list / launch-face / canvas

## Validation

- [x] `node --test` list, launch-face, canvas, window-bar, viz-kit (172 pass, 1 skipped)
- [ ] `npx tsc --noEmit`
- [ ] Screenshots (Chrome, 1176) of Jamie Jones draft + D.O.D list pace — attach after preview

## Notes

Merge after #903 (`cursor/plan-v2-live-fix-adjust`). This branch is off `main` `895224b` and does not include the adjust-face reading-unit work. Do not merge.
