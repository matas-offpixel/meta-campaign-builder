# Session log

## PR

- **Number:** 287
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/287
- **Branch:** `data/manchester-wc26-events-seed`

## Summary

Adds migration `078` to backfill three **existing** WC26 Manchester shell events (slugs `wc26-manchester-croatia`, `wc26-manchester-panama`, `wc26-manchester-last32`): `UPDATE` venue/capacity/dates from Ghana, delete orphan `tier_channel_allocations` on Croatia/Panama + clear `tier_channel_sales`, then insert tiers/channel rows from `MASTER Allocations.xlsx` (Depot Manchester tab). Inserts run only when Croatia has zero `event_ticket_tiers`. Parser fix for date-prefixed fixture titles remains in `master-allocations-parser.ts`.

**Note:** If an environment already applied an older `078` body that no-op’d early, Supabase will not re-run this file—use a follow-up migration or manual SQL there.

## Scope / files

- `supabase/migrations/078_manchester_wc26_seed_events.sql`
- `lib/dashboard/master-allocations-parser.ts`
- `scripts/gen-manchester-wc26-seed-sql.mjs`, `scripts/emit-manchester-wc26-migration-sql.mjs` (generator helpers; optional for regenerating tier SQL from the xlsx)

## Validation

- [x] `npx eslint lib/dashboard/master-allocations-parser.ts`
- [ ] `npm run lint` (workspace has unrelated broken paths in another thread)
- [ ] Apply migration on staging/prod Supabase when ready
- [ ] Post-apply SQL (paste results into PR when run):

```sql
SELECT name, capacity, event_date, event_start_at FROM events WHERE event_code='WC26-MANCHESTER';

SELECT e.name, COUNT(ett.id) AS tiers,
       COALESCE(SUM(tcs.tickets_sold) FILTER (WHERE tc.channel_name='Venue'), 0) AS venue_sold
FROM events e
LEFT JOIN event_ticket_tiers ett ON ett.event_id = e.id
LEFT JOIN tier_channel_sales tcs ON tcs.event_id = e.id
LEFT JOIN tier_channels tc ON tc.id = tcs.channel_id
WHERE e.event_code='WC26-MANCHESTER' GROUP BY e.id, e.name;
```

## Notes

- Croatia Venue sold totals **63** and Panama **189** match summed Venue column from the Manchester sheet (tier_channel_sales rows).
- Last 32 tier ladder uses Croatia allocations where the sheet leaves allocation cells blank; fixture row names use `regexp_replace` on the Ghana template title.
