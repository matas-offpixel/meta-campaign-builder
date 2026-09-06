# Session log

## PR

- **Number:** 893
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/893
- **Branch:** `cursor/plan-v2-tokens`

## Summary

Tokens PR for plan v2 — canon §4 implemented exactly as written. Line kinds, split outlines, WindowBar pace, MetricChip benchmark rules, Locked, state/action words, the unconnected-share Launch gate, G29 comment rename, and G34's benchmark window constant. No face redesign, no `evaluate.ts` edits, no migration.

## Scope / files

- `lib/viz/tokens.ts` — VIZ_LINE_*, provenance words/map, VIZ_STATE_WORD / VIZ_ACTION_WORD / VIZ_UNIT_WORD / VIZ_TICKET_LINE_WORD, VIZ_CLIENT_SAFE
- `components/viz/{funnel-stage-bar,split-bar,metric-chip,threshold-band,window-bar,channel-row,provenance-badge,info-tip,locked}.tsx`
- `lib/plan/preflight.ts` + `lib/plan/unconnected-share.ts` — item 19 Launch gate
- `lib/plan/benchmark-window.ts` — G34
- `lib/optimisation-rules.ts` — G29 comment
- `lib/viz/__tests__/viz-kit-redesign.test.ts` — §4.7 guards
- Daily canvas surfaces no longer mount `ProvenanceBadge`

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5140 pass, 3 skipped)

## Notes

Already-live plans are grandfathered (D.O.D 299dd4e5). Do not build the benchmark view in this PR.
