# Session log — funnel visual pass

## PR

- **Number:** 866
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/866
- **Branch:** `cursor/funnel-visual-pass`

## Summary

Completes the #865 visual-language pass: the per-event funnel card is now
proportional bars (sqrt scale) with conversion % on the joins, and three
live-review nits on `/plan/[id]` are fixed. Presentation-only.

## Scale

**sqrt.** Reach would flatten every later stage under a linear scale.
log1p compresses too far (mid-funnel stages look almost equal). Sqrt
keeps the cascade readable and is zero-safe (`sqrt(0) = 0`).

## Scope / files

### Kit extensions

- `lib/viz/funnel-scale.ts` — `proportionalBarWidths`, delta tone, platform shares
- `lib/viz/tokens.ts` — `VIZ_PLATFORM_BAR`, provenance marks, delta tokens
- `lib/viz/blockers.ts` — `collectBadgeRows` (blocker vs advisory)
- `components/viz/funnel-stage-bar.tsx`, `provenance-badge.tsx`, `section-anchor.tsx`
- `components/viz/blocker-badge.tsx` — amber blockers, muted advisories

### Surfaces

- `/plan/[id]` nits: SectionAnchor (image / derive arrows) + ⓘ; advisories
  only in the expanded badge; no stray corner ⓘ
- Event funnel card (event report + share, same component, `tonality` kept)

## Validation

- [x] `npx tsc --noEmit` — no errors in touched files
- [x] `npx eslint` on touched viz / plan / funnel files — clean
- [x] `npm run build` — compiled successfully
- [x] `npm test` — 4659 tests, 1174 suites; 4656 pass, 0 fail, 3 skipped
- [x] Falsified against parent sha `0902624`: `lib/viz/funnel-scale.ts` absent;
      parent workspace still prints `split.notes.map` as standing text

## Notes

Funnel math is still `lib/dashboard/event-funnel.ts` only. Named
FunnelCostCell states stay on MetricChip tooltips. Not-instrumented
stages are dashed outlines, never hidden.
