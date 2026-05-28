# Session log — allocator dedupe per event_code

## PR

- **Number:** 483
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/483
- **Branch:** `cc/allocator-dedupe-per-event-code`

## Summary

Dedupe venue-spend-allocator to once per `(client_id, event_code)` in batch
rollup loops (force backfill, cron, show-week burst). Fixes platform 500 at ~81s
when duplicate Brighton Meta fetches stacked. Adds structured fatal error logging
on force backfill.

## Scope / files

- `lib/dashboard/venue-allocator-batch-dedupe.ts` — dedupe key + helpers
- `lib/dashboard/__tests__/venue-allocator-batch-dedupe.test.ts`
- `lib/dashboard/rollup-sync-runner.ts` — optional `venueAllocatorCompletedKeys`
- `app/api/admin/event-rollup-backfill/route.ts` — pass Set + fatal catch
- `app/api/cron/rollup-sync-events/route.ts`
- `app/api/cron/show-week-burst/route.ts`

## Validation

- [x] `node --test lib/dashboard/__tests__/venue-allocator-batch-dedupe.test.ts` (5/5)
- [ ] `npm run lint` (worktree has no node_modules)

## Notes

Refs #481, #482, verification findings #3 (504) and #4 (81s 500).
