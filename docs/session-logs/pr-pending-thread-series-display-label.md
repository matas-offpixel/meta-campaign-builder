# Session log

## PR

- **Number:** pending
- **URL:** (after `gh pr create`)
- **Branch:** `thread/series-display-label`

## Summary

Adds `SERIES_DISPLAY_LABELS` + `getSeriesDisplayLabel()` for branded multi-fixture venue cards (canary: Arsenal Title Run In). Portal venue parent headers and rollout audit group subtitles use the friendly label when configured; otherwise venue name / code unchanged.

## Scope / files

- `lib/dashboard/rollout-grouping.ts`, `lib/dashboard/__tests__/rollout-grouping.test.ts`
- `components/share/client-portal-venue-table.tsx`
- `components/dashboard/clients/rollout/client-rollout-view.tsx`

## Validation

- [x] `node --test lib/dashboard/__tests__/rollout-grouping.test.ts`
