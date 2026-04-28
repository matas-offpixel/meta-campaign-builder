## PR

- **Number:** 151
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/151
- **Branch:** `creator/tiktok-rollup-sync-wiring`

## Summary

Migration 056 must be applied via Cowork Supabase MCP after merge before tests will pass in prod. PR-B and PR-C depend on this. This PR wires TikTok Business API daily campaign metrics into `event_daily_rollups` so TikTok-only events can use the existing pacing, daily tracker, and share-spend surfaces once the migration is live.

## Scope / files

- Adds migration 056 for TikTok-owned rollup columns and the partial TikTok index.
- Adds a TikTok daily rollup insights helper and a pure TikTok rollup leg with 50001 one-shot retry handling.
- Starts the TikTok leg independently from the existing Meta branch and upserts only `tiktok_*` columns plus `source_tiktok_at`.
- Threads event/client TikTok account fallback through rollup-sync callers.
- Extends timeline row shapes so TikTok totals can be selected without changing existing Meta/Eventbrite aggregation semantics.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run lint` (fails on pre-existing baseline issues in untouched files; edited files are lint-clean)
- [x] `npm run build`
- [x] `npm test`

## Notes

Migration 056 must be applied via Cowork Supabase MCP after merge, followed by Supabase type regeneration for `lib/db/database.types.ts`. PR-B should not start until that production migration/type step is confirmed.
