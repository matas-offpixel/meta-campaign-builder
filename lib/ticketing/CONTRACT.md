# Ticketing sync channel-ownership contract

## Invariant: sync owns exactly one channel per provider connection

Each ticketing provider connection is mapped to a single **source channel**
(e.g. `4TF` for `fourthefans`, `Eventbrite` for `eventbrite`).

The rollup-sync pipeline (`lib/dashboard/rollup-sync-runner.ts`) MUST:

1. **Only write `event_ticket_tiers.quantity_sold`** for the tiers returned
   by the connection's provider API. The sync treats `quantity_sold` as the
   "provider channel slice" — the hybrid resolver in
   `lib/dashboard/ticket-revenue-resolver.ts` adds operator-entered
   `tier_channel_sales` rows at read time.

2. **Never touch `tier_channel_sales`** — this table is operator-managed.
   Rows may exist for any channel (Venue, CP, SeeTickets, DS, etc.) and are
   entered manually via the dashboard UI or bulk imports. Sync code MUST NOT
   insert, update, or delete rows in `tier_channel_sales`.

3. **Never touch `additional_ticket_entries`** — these rows capture ad-hoc
   sales (e.g. door sales, offline blocks) and are entered by operators.
   Sync code must not modify them.

## Which functions are allowed in sync paths

| Function | File | May be called from sync | Notes |
|----------|------|------------------------|-------|
| `replaceEventTicketTiers` | `lib/db/ticketing.ts` | ✅ Yes | Writes `event_ticket_tiers` only |
| `updateEventCapacityFromTicketTiers` | `lib/db/ticketing.ts` | ✅ Yes | Writes `events.capacity` only |
| `insertSnapshot` | `lib/db/ticketing.ts` | ✅ Yes | Writes `ticket_sales_snapshots` only |
| `upsertEventbriteRollups` etc. | `lib/db/event-daily-rollups.ts` | ✅ Yes | Writes `event_daily_rollups` only |
| `upsertTierChannelSale` | `lib/db/tier-channels.ts` | ❌ Never | Operator-owned table |
| `deleteTierChannelSale` | `lib/db/tier-channels.ts` | ❌ Never | Operator-owned table |

## Validation

To verify the invariant still holds after a sync run for a Manchester event:

```sql
-- Seed a manual Venue channel row
INSERT INTO tier_channel_sales (event_id, tier_name, channel_id, tickets_sold)
SELECT 'ba05a442-bc21-432f-bec9-0f5ae5f02c84', 'General', id, 50
FROM tier_channels WHERE channel_name = 'Venue'
ON CONFLICT DO NOTHING;

-- Run sync: POST /api/ticketing/rollup-sync?eventId=ba05a442-bc21-432f-bec9-0f5ae5f02c84

-- Assert Venue row unchanged
SELECT tickets_sold FROM tier_channel_sales tcs
JOIN tier_channels tc ON tc.id = tcs.channel_id
WHERE tcs.event_id = 'ba05a442-bc21-432f-bec9-0f5ae5f02c84'
  AND tc.channel_name = 'Venue';
-- must still be 50
```

## Regression test

`lib/ticketing/__tests__/rollup-sync-channel-safety.test.ts` covers:

- `replaceEventTicketTiers` never accesses `tier_channel_sales`
- A concurrent Venue+CP+4TF scenario where only `event_ticket_tiers` rows
  change after a simulated sync write
