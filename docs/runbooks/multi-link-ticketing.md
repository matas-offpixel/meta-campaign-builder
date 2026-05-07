# Multi-link ticketing runbook

How to wire multiple external ticketing IDs to a single dashboard event —
covering presale splits, capacity expansions, and multi-vendor scenarios.

---

## Why multi-link exists

A single 4theFans event on the dashboard may correspond to more than one
external ticketing record. Common scenarios:

| Scenario | External IDs |
|----------|-------------|
| Presale + general-sale on the same event | 2 IDs (one per phase) |
| Capacity expansion (extra allocation released) | 2+ IDs |
| Multi-vendor (4theFans + WeAreFootballFestival) | 2 IDs |
| Outernet presale (18155) + live sale (18147) | 2 IDs |

Multi-link support shipped in PR #304. Each link row in
`event_ticketing_links` is now **independent** — the sync runner merges
all linked external IDs into a single `event_ticket_tiers` snapshot for
the event.

---

## Step-by-step: add a second ticketing link

### 1. Navigate to the event

```
/clients/{client-id}/venues/{event-code}/events/{event-id}
```

Open the **Ticketing** tab on the event detail page.

### 2. Add the new link

Click **Add link** and enter the external event ID (e.g. `18155` for the
Outernet presale).

The dashboard will prompt for:
- **Provider** — `4thefans` or `fourthefans_wearefootball` (WeAreFootball)
- **External event ID** — the numeric or string ID from the provider's system
- **API base** (optional) — override when the connection uses a non-standard
  base URL (e.g. `https://wearefootballfestival.book.tickets/wp-json/agency/v1`)

> For the Outernet presale: provider = `fourthefans`, external ID = `18155`.
> The client-level connection credentials will be used automatically.

### 3. Run sync

Click **Sync now** on the event detail page, or POST to:

```
/api/ticketing/rollup-sync?eventId={event-uuid}
```

The runner merges tiers from all linked external IDs. If both 18147 and 18155
exist, `event_ticket_tiers` will reflect the combined sold/available counts.

### 4. Verify

Check that:
- `event_ticket_tiers` shows merged tier data (not duplicated)
- `ticket_sales_snapshots` has a new row for the sync run
- The dashboard event card shows the updated ticket count

---

## Known edge case: additional_ticket_entries and >100% display

When an event has `additional_ticket_entries` rows that capture sales
from a presale event **and** the presale external ID is also linked,
the dashboard can display >100% sold because both paths add to the
ticket total.

**Resolution:** remove the `additional_ticket_entries` rows that
duplicate the presale-linked ID's data, and let the sync drive the
count from `event_ticket_tiers` directly.

> This is the reason Outernet event 18155 was added and then removed —
> the `additional_ticket_entries` path caused >100% display. Once the
> entries are cleaned up, re-add link 18155 following this runbook.

---

## Outernet presale: step-by-step (pending)

1. Go to event `9d9bd605-bd9c-49a0-9e5f-d73ebf881bd1` (Outernet Final):
   ```
   /clients/{4thefans-client-id}/venues/4TF26-ARSENAL-CL-FL/events/9d9bd605-bd9c-49a0-9e5f-d73ebf881bd1
   ```
2. **Ticketing tab** — verify that any `additional_ticket_entries` rows
   that capture the 456-ticket presale block have been removed (or
   confirm that adding 18155 would not double-count).
3. **Add link** → enter `18155`, provider `fourthefans`.
4. **Sync now** → confirm `event_ticket_tiers` shows combined data.
5. Verify event card: total sold should not exceed capacity.

---

## Multi-vendor example: WeAreFootballFestival + 4theFans

Manchester WC26 Croatia (`ba05a442`) has:

- **4theFans link** (event ID 46) — the main ticketing channel
- **WeAreFootballFestival link** (event ID 46 via external_api_base
  `https://wearefootballfestival.book.tickets/wp-json/agency/v1`)

Both links are active. The sync runner fetches from each API independently
and merges the tier breakdown. Non-4TF channel rows in `tier_channel_sales`
(Venue, CP, SeeTickets, DS) are operator-entered and are **never touched**
by sync — see `lib/ticketing/CONTRACT.md` for the channel-ownership invariant.

---

## Channel-ownership invariant

> Sync owns exactly one channel per provider connection. Operator-entered
> channels (`tier_channel_sales` rows for Venue, CP, SeeTickets, DS) must
> never be written, deleted, or modified by sync.

See `lib/ticketing/CONTRACT.md` for the full specification and SQL
validation recipe.

---

## Related files

- `lib/db/ticketing.ts` — `replaceEventTicketTiers`, `insertSnapshot`
- `lib/dashboard/rollup-sync-runner.ts` — sync orchestration
- `lib/ticketing/CONTRACT.md` — channel-ownership invariant
- `lib/ticketing/fourthefans/provider.ts` — 4theFans API adapter
- `supabase/migrations/` — `event_ticketing_links` schema lives in migration 029
