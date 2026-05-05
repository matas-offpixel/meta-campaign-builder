# Session log

## PR

- **Number:** 287
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/287
- **Branch:** `data/manchester-wc26-events-seed`

## Summary

Adds migration `078` to seed three missing WC26 Manchester (Depot Mayfield) events—England v Croatia, England v Panama, and Last 32—by cloning the existing Manchester Ghana event for venue linkage and rolling tier/channel rows from the same `MASTER Allocations.xlsx` logic as `master-allocations-parser`. Fixes parser section detection so date-prefixed fixture titles (e.g. Manchester tab) import correctly instead of being skipped.

## Scope / files

- `supabase/migrations/078_manchester_wc26_seed_events.sql`
- `lib/dashboard/master-allocations-parser.ts`
- `scripts/gen-manchester-wc26-seed-sql.mjs`, `scripts/emit-manchester-wc26-migration-sql.mjs` (generator helpers; optional for regenerating tier SQL from the xlsx)

## Validation

- [x] `npx eslint lib/dashboard/master-allocations-parser.ts`
- [ ] `npm run lint` (workspace has unrelated broken paths in another thread)
- [ ] Apply migration on staging/prod Supabase when ready

## Notes

- Croatia Venue sold totals **63** and Panama **189** match summed Venue column from the Manchester sheet (tier_channel_sales rows).
- Last 32 tier ladder uses Croatia allocations where the sheet leaves allocation cells blank; fixture row names use `regexp_replace` on the Ghana template title.
