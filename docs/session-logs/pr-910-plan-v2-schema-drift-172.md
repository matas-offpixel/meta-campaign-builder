# Session log

## PR

- **Number:** 910
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/910
- **Branch:** `cursor/plan-v2-schema-drift-172`

## Summary

G35. `events.meta_ad_account_id text` as `add column if not exists` so schema and types name the column production already has. No-op on prod. Resolver prefers the event's own account over the client default.

## Scope / files

- `supabase/migrations/172_events_meta_ad_account_id.sql`
- `supabase/schema.sql`
- `lib/db/database.types.ts`

## Validation

- [x] migration is `if not exists` only — no backfill, no index
- [ ] Matas applies 172

## Notes

Draft titled `[needs migration apply]`. Do not apply in this run. `venue_key` (167) is the same class of drift and is out of scope.
