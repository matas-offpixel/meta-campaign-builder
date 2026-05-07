# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/ticketing-scope-rollup-sync-channel`

## Summary

Protects operator-entered channel sales (Venue, CP, SeeTickets, DS, etc.) from
being clobbered by the 4theFans ticketing rollup-sync. An audit confirmed the
sync pipeline never touches `tier_channel_sales` or `additional_ticket_entries`
today; this PR encodes that as a written contract and enforces it with 8 static
regression tests so the invariant can't accidentally regress.

## Scope / files

- `lib/ticketing/CONTRACT.md` — new; documents the channel-ownership invariant,
  approved vs. forbidden functions in sync paths, and a SQL validation recipe
- `lib/dashboard/rollup-sync-runner.ts` — added CHANNEL-OWNERSHIP INVARIANT
  block to the module-level JSDoc comment
- `lib/ticketing/__tests__/rollup-sync-channel-safety.test.ts` — new; 8 static
  source-analysis tests asserting the invariant holds

## Validation

- [x] `npm test` — 710 pass, 1 skipped, 0 fail (pre-existing skip unchanged)
- [x] `npx tsc --noEmit` — only pre-existing error in unrelated `lib/meta/__tests__/audience-idempotency.test.ts`

## Notes

The TS error in `lib/meta/__tests__/audience-idempotency.test.ts` is pre-existing
(tracked in `lib/meta/__tests__/audience-write.test.ts` dirty state from before
this session) and is not introduced by this PR.

Manual validation recipe for Manchester Croatia:
```sql
-- Seed Venue row
INSERT INTO tier_channel_sales (event_id, tier_name, channel_id, tickets_sold)
SELECT 'ba05a442-bc21-432f-bec9-0f5ae5f02c84', 'General', id, 50
FROM tier_channels WHERE channel_name = 'Venue' ON CONFLICT DO NOTHING;
-- Run sync: POST /api/ticketing/rollup-sync?eventId=ba05a442-bc21-432f-bec9-0f5ae5f02c84
-- Assert: SELECT tickets_sold FROM tier_channel_sales tcs
--   JOIN tier_channels tc ON tc.id = tcs.channel_id
--   WHERE tcs.event_id = 'ba05a442-...' AND tc.channel_name = 'Venue';
-- Expected: 50 (unchanged)
```
