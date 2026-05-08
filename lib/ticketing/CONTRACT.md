# Ticketing sync channel-ownership contract

## Invariant: sync owns only the provider automatic channel

Each ticketing provider connection is mapped to a single **source channel**
(e.g. `4TF` for `fourthefans`, `Eventbrite` for `eventbrite`).

The rollup-sync pipeline (`lib/dashboard/rollup-sync-runner.ts`) MUST:

1. **Write `event_ticket_tiers.quantity_sold`** for the tiers returned
   by the connection's provider API. This keeps the full tier snapshot
   available for capacity and reporting.

2. **Only upsert the provider-owned automatic channel in
   `tier_channel_sales`**. For `fourthefans`, that means the client's
   automatic `4TF` channel. Sync code MUST NOT delete rows, null/refill an
   event, or touch operator-owned channels (Venue, CP, SeeTickets, DS, Other).
   Existing manual/import rows for the same event must be preserved.

3. **Never touch `additional_ticket_entries`** — these rows capture ad-hoc
   sales (e.g. door sales, offline blocks) and are entered by operators.
   Sync code must not modify them.

## Which functions are allowed in sync paths

| Function | File | May be called from sync | Notes |
|----------|------|------------------------|-------|
| `replaceEventTicketTiers` | `lib/db/ticketing.ts` | ✅ Yes | Writes `event_ticket_tiers` only |
| `upsertProviderTierChannelSales` | `lib/db/ticketing.ts` | ✅ Yes | Upserts provider automatic channel only (`4TF` for `fourthefans`) |
| `updateEventCapacityFromTicketTiers` | `lib/db/ticketing.ts` | ✅ Yes | Writes `events.capacity` only |
| `insertSnapshot` | `lib/db/ticketing.ts` | ✅ Yes | Writes `ticket_sales_snapshots` only |
| `upsertEventbriteRollups` etc. | `lib/db/event-daily-rollups.ts` | ✅ Yes | Writes `event_daily_rollups` only |
| `upsertTierChannelSale` | `lib/db/tier-channels.ts` | ❌ Never in sync | Operator/admin UI helper |
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

-- Assert Venue row unchanged and 4TF row upserted only for provider tiers
SELECT tickets_sold FROM tier_channel_sales tcs
JOIN tier_channels tc ON tc.id = tcs.channel_id
WHERE tcs.event_id = 'ba05a442-bc21-432f-bec9-0f5ae5f02c84'
  AND tc.channel_name = 'Venue';
-- must still be 50
```

## Regression test

`lib/ticketing/__tests__/rollup-sync-channel-safety.test.ts` covers:

- `replaceEventTicketTiers` never accesses `tier_channel_sales`
- `rollup-sync-runner.ts` writes provider channel sales only through
  `upsertProviderTierChannelSales`
- A concurrent Venue+CP+4TF scenario where only `event_ticket_tiers` and the
  provider-owned `4TF` channel rows change after a simulated sync write
