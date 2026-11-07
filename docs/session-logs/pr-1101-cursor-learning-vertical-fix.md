# Session log

## PR

- **Number:** 1101
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1101
- **Branch:** `cursor/learning-vertical-fix`

## Summary

Tag learnings at vertical scope were the same rows as `all`, because `clients.vertical` is `NOT NULL` default `music` and the join also defaulted a missing vertical to music. A client now contributes to a vertical only when that vertical is stored on the client. Archived clients stay out. A client with no vertical stays in client and all scope. `tag_performance.events_n` counts distinct real shows (migration 208, not applied). A ticket-sale result is initiate checkout when the ad set's promoted event is `INITIATED_CHECKOUT`.

No client vertical was written. Kick Off Club is archived and stored as `music`; its events are international fixtures, so the real vertical is football. Confirm before any update.

## Scope / files

- `lib/learning/joins.ts` — vertical is null when blank; ticket-sale result reads initiate checkout; shows map for the tag job
- `lib/learning/tag-performance.ts` — vertical scope, `events_n`
- `lib/learning/copy/score.ts`, `lib/learning/copy-performance.ts` — no music default
- `lib/learning/funnel-benchmarks.ts` — `lpv_to_purchase` uses the ticket-sale result
- `lib/learning/runner.ts`, `scripts/learning-refresh.mts`
- `supabase/migrations/208_tag_performance_events_n.sql` — written, not applied
- sha256 `ac73319b828d4130fded112ea6c4730b934779a10ccda4312c3d5c99681539e4`

## Validation

- [x] `npm test`
- [x] `npm run build`
- [x] `npx tsx --env-file=.env.local scripts/learning-refresh.mts --dry-run` (nothing written)

Dry run: vertical rows music 90, equal to all 90. Puzzle ticket-sale results in 90 days: purchases 6 → 955, all initiate checkout. Campaign-code Puzzle events in that window: purchases 0, initiate checkout 84, inside the 955.

## Notes

Migration 208 is not applied. `clients.vertical` was not updated.
