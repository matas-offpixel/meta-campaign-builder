# Session log

## PR

- **Number:** pending
- **URL:** (after `gh pr create`)
- **Branch:** `thread/series-display-label`

## Summary

Adds `lib/dashboard/series-display-labels.ts` with Club Football / branded `event_code` → friendly parent-row titles. Portal grouped + solo venue cards and rollout audit group subtitles use `getSeriesDisplayLabel(code) ?? venue/name fallback`. Grouping keys unchanged (PR #302).

## Scope / files

- `lib/dashboard/series-display-labels.ts`, `lib/dashboard/__tests__/series-display-labels.test.ts`
- `components/share/client-portal-venue-table.tsx`
- `components/dashboard/clients/rollout/client-rollout-view.tsx`
- `lib/dashboard/rollout-grouping.ts` (removed duplicate label helpers — single source in `series-display-labels.ts`)
- `lib/dashboard/__tests__/rollout-grouping.test.ts` (label tests live with series-display-labels tests)

## Validation

- [x] `node --test lib/dashboard/__tests__/rollout-grouping.test.ts lib/dashboard/__tests__/series-display-labels.test.ts`
