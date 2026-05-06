# Session log

## PR

- **Number:** pending
- **URL:** (after `gh pr create`)
- **Branch:** `thread/grouping-by-event-code-only`

## Summary

Relaxes venue-series grouping: **≥2 rows with the same `event_code` always share `series:${event_code}`**, regardless of `venue_name`. Removes the mixed-venue tuple split. Singleton code buckets and `__solo__` unchanged.

## Scope / files

- `lib/dashboard/rollout-grouping.ts`
- `lib/dashboard/__tests__/rollout-grouping.test.ts`
- `lib/db/__tests__/client-dashboard-aggregations.test.ts`
- `lib/db/client-dashboard-aggregations.ts` (comment only)

## Validation

- [x] `node --test lib/dashboard/__tests__/rollout-grouping.test.ts lib/db/__tests__/client-dashboard-aggregations.test.ts`
