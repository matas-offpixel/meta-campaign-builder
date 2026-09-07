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
- [x] `npm run build` (again after the baseline commit)
- [x] `npm test` (5398 pass, 3 skipped; again after the baseline commit)
- [x] Ubuntu rasters from [frames-baselines 34167981727](https://github.com/matas-offpixel/meta-campaign-builder/actions/runs/34167981727) — 12 PNGs changed, 25 byte-identical
- [ ] CI `frames:check` green after those 12 land

## Notes

Keep: measured / estimated / not-yet; §2.6 words; no invented numbers; G34; `frames:check`.

Regenerated, narrowly, the 12 frames the history sentence actually moved: A0, A1, A2, A4, A6, A8, A9, A10, A11, A13, A14, A15. Reason: history line dropped `for Electric Brixton`. A0 is the same sentence un-gated — it never named a client, so the line is new and the frame grew 16px.

**Named debt — A14 and siblings are unguarded on the list.** A14 and its siblings assert the count sentence only; the inline blocker list under it is unguarded until Stage 2 draws it into the frames. Stage 2's brief already carries that payer: [plan-canvas-revamp-brief-2026-09-07](./plan-canvas-revamp-brief-2026-09-07.md) §3.5 / §4 Stage 2 ("blocker list on the frames"). Until then a live-list regression will not turn `frames:check` red.

Stage 2 (design thread, not Cursor): card primitive, two-column grid, channel card, budget card with a total, blocker list on the frames, canon §4 rewrite.

> The canvas told the truth and forgot to say anything. Give every zone a container, a headline number and a comparison, put the channel's controls inside the channel's card, always show the list behind a count, and lead the budget with the total — without giving up a single one of the three line kinds.
