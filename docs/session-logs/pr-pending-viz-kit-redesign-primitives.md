# Session log — viz kit redesign primitives

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/viz-kit-redesign-primitives`

## Summary

PR 1 of 7 for the campaign-creator redesign. Extends the viz kit so the
canvas (PR 3) and drawers (PR 4–5) have the tokens and primitives they
need. No screens change.

## Scope / files

- `lib/viz/tokens.ts` — `blocked` status, `derived` provenance
- `lib/viz/blockers.ts` — `anchor` on rows
- `lib/viz/{split-bar,window-bar,channel-row,drawer,asset-strip}.ts` — view models
- `components/viz/{metric-chip,blocker-badge,funnel-stage-bar}.tsx` — extensions
- `components/viz/{split-bar,drawer,channel-row,window-bar,asset-strip}.tsx` — new
- `lib/viz/__tests__/{viz-kit-redesign,no-inline-colour}.test.ts`

## Validation

- [x] viz tests 64/64
- [x] `npm test` — 4829 pass, 1 pre-existing D2C date fail
- [x] `npm run build`

## Notes

- `FunnelBarSegments` extracted from `FunnelStageBar` so SplitBar composes the track. Not a fifth primitive.
- Drawer `open` + `triggerRef` are required for open/closed and the #871 closer; not listed in §7 props.
- No jsdom in this repo; Drawer click reachability is the #871 model plus a source grep that Done/tabs live in the portaled tree.
