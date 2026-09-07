# Session log

## PR

- **Number:** 918
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/918
- **Branch:** `cursor/plan-canvas-stage1-usable`

## Summary

Stage 1 of the plan-canvas revamp: make tonight's Folamour screen usable without a new visual language. ⓘ dismisses on outside click, Escape, and a visible close, one open at a time. Blocker counts render their list. History no longer names the client (NX Promoter stays the Meta identity; Electric Brixton stays in the header ⓘ). Plan surfaces cap at 1280px. Cards, totals, channel objects, and the 36-frame redraw are Stage 2 / Stage 3.

## Scope / files

- `components/viz/info-tip.tsx` + `lib/viz/info-tip.ts` — one click behaviour; #871 closer
- `components/plan/blocker-items.tsx` — list behind a count
- `components/plan/canvas-channels.tsx` / `canvas-launch.tsx` / `plan-workspace.tsx` — items + cure links; frames omit the list
- `lib/plan/launch-face.ts` — `formatHistoryEmpty` drops the client name; `launchBlockerRows`
- `lib/plan/surface.ts` — `max-w-[1280px]`
- `components/plan/canvas-budget.tsx` — history sentence without a second proper noun

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5398 pass, 3 skipped)

## Notes

Keep: measured / estimated / not-yet; §2.6 words; no invented numbers; G34; `frames:check`.

Do not regenerate the 36 baselines in this PR. Inline lists are live-workspace only (`onOpenAnchor` / `onOpenBlocker`); frame-mount stays sentence-only so A14 does not grow. History copy is shorter — frames that printed `for Electric Brixton` will pixel-diff; that is a Stage 3 redraw, not a Stage 1 baseline bump.

Stage 2 (design thread, not Cursor): card primitive, two-column grid, channel card, budget card with a total, blocker list on the frames, canon §4 rewrite.

> The canvas told the truth and forgot to say anything. Give every zone a container, a headline number and a comparison, put the channel's controls inside the channel's card, always show the list behind a count, and lead the budget with the total — without giving up a single one of the three line kinds.
