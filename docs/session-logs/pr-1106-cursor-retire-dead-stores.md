# Session log

## PR

- **Number:** 1106
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1106
- **Branch:** `cursor/retire-dead-stores`

## Summary

`event_funnel_overrides` had no rows and no reader, and the note that a Funnel Planner shell used it was wrong. `campaign_daily_insights` has no reader or writer; `ad_daily_insights` replaced it. Migration 209 drops both. The unused funnel aggregations module goes with them. The migration is written, not applied.

## Scope / files

- `supabase/migrations/209_retire_dead_stores.sql`
- deleted `lib/dashboard/funnel-aggregations.ts` and its test
- `CLAUDE.md`
- `lib/dashboard/__tests__/retired-stores-209.test.ts`

## Validation

- [x] `npm test`
- [x] `npm run build`

## Notes

`lib/dashboard/__tests__/client-funnel-benchmarks.test.ts` still matches the name `event_funnel_overrides` inside migration 158, which distinguishes the live benchmark table from 060. `schema.sql` and `lib/db/database.types.ts` still describe `event_funnel_overrides`. Neither was edited.
