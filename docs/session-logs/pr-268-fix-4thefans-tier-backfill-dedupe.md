# Session Log

## PR

- **Number:** 268
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/268
- **Branch:** `fix/4thefans-tier-backfill-dedupe`

## Summary

Hardens 4thefans tier persistence for payloads that contain duplicate tier names by merging duplicates before the `(event_id, tier_name)` upsert.

## Scope / files

- `lib/db/ticketing.ts`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint <changed files>`
- [x] `npm run build`

## Notes

Production backfill verification found a few non-Brighton events with duplicate tier names, which caused Postgres to reject the upsert with `ON CONFLICT DO UPDATE command cannot affect row a second time`.
