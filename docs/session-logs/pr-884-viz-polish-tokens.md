# Session log

## PR

- **Number:** 884
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/884
- **Branch:** `cursor/viz-polish-tokens`

## Summary

PR 8a of the campaign-creator visual polish: named type scale, sand-palette platform tints, monochrome provenance, `formatVizMoment`, and leaf primitive restyle. No canvas / drawer-interior / plan-zone work — that is 8b.

## Scope / files

- `docs/CAMPAIGN_CREATOR_POLISH_2026-09-04.md`
- `lib/viz/tokens.ts`, `lib/viz/format-moment.ts`, `lib/viz/split-bar.ts`, `lib/viz/window-bar.ts`
- `components/viz/*` leaf primitives
- `lib/viz/__tests__/*` guards (type scale, contrast, no-hue, format-moment)

## Validation

- [x] `npx tsc --noEmit` (pre-existing jest-fixture noise only; no `lib/viz` / `components/viz` errors)
- [x] `npm run build`
- [x] `npm test` (5084, 0 fail)

## Notes

`formatVizMoment` lives in `lib/viz/format-moment.ts` (ruling 1). Google tint is muted violet. `lib/landing-pages/format-datetime.ts` is untouched. In-segment SplitBar labels overlay the 28px row rather than living inside `FunnelBarSegments` — the shared track is 10px.
