# Session log: multi-channel ticket allocation model + venue page editability + revenue auto-compute

## PR

- **Number:** 282
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/282
- **Branch:** `feat/multi-channel-allocation-and-venue-edits`

## Summary

Replaces the single-channel `additional_ticket_entries` running-total
model with a multi-channel allocation + sales model so 4thefans
operators can see per-channel performance (4TF / Eventbrite /
Venue / SeeTickets / CP / Other) at a glance and update manual
channels weekly. Adds three pieces:

1. New tables `tier_channels`, `tier_channel_allocations`,
   `tier_channel_sales` with UPSERT semantics — last entry wins per
   `(event_id, tier_name, channel_id)`.
2. A new `MultiChannelTicketEntryCard` rendered on both the internal
   venue view and the public venue share report. Inline-editable
   when the share token has `can_edit=true`. Revenue auto-computes
   from `price × tickets_sold`, with an explicit override toggle that
   surfaces an `(i)` tooltip on overridden rows.
3. Click-to-edit per-event marketing budgets in the venue header
   (gated on share `can_edit`) and a `shareToken` mode for
   `VenueAdditionalSpendCard` so the existing additional-spend card
   keeps working on the share surface.

The XLSX seed for 4thefans (`MASTER Allocations.xlsx`) is processed
by a new admin route — POST the file once and it idempotently
populates channels, allocations, and (non-Brighton) sales rows.

## Findings (per investigation list)

1. **Channel inventory by venue tab** — parsed from the workbook:
   - **Central Park (Brighton):** 4TF, SeeTickets, CP — sold values
     for SeeTickets/CP intentionally skipped on import per the
     `skip_brighton_sold` decision; allocations still seed.
   - **O2 Institute (Birmingham):** 4TF, Venue.
   - **Other 10 tabs (Margate, Manchester, Bournemouth, Leeds,
     Newcastle, Shepherds Bush, Kentish Town, Glasgow O2, Glasgow
     SWG3, Bristol):** 4TF + a venue-specific subset of {Venue,
     SeeTickets, CP, DS, Other}. The parser detects channels per
     tab dynamically rather than relying on a fixed list.
2. **Existing schemas** —
   - `event_ticket_tiers` (PR #261) carried a single
     `quantity_sold`/`quantity_available` per tier; we now treat its
     rows as the implicit `4TF` channel and merge channel rows on
     top.
   - `additional_ticket_entries` (PR #276) was a label-based stop-gap
     used per-event; left in place behind the legacy panel on the
     internal surface only, so existing operator flows keep
     working until the data is migrated.
3. **Marketing budget edit flow** — the per-event report writes via
   `PATCH /api/events/[id]/plan` (covered by the event detail page).
   The venue header had no edit hook, so the report displayed the
   summed figure but the only way to edit it was to dive into each
   event card. New share-token `PATCH /api/share/venue/[token]/budget`
   route + `VenueBudgetClickEdit` component close that gap.
4. **Share-token `can_edit` semantics** — share rows with
   `can_edit=true` already gated the per-event share report's write
   buttons (PR #111 / `assertVenueShareTokenWritable`). The venue
   surface was missing the propagation: the legacy
   `VenueAdditionalSpendCard` always called the cookie-auth route,
   which 401'd on the share surface. This PR adds a `shareToken`
   prop that re-routes to `/api/venues/by-share-token/...` when
   present, fixing the regression flagged by the client.

## Scope / files

### Migrations

- `supabase/migrations/076_tier_channels.sql` — `tier_channels`
  (client-scoped, automatic flag, seed for 4thefans).
- `supabase/migrations/077_tier_channel_allocations_and_sales.sql` —
  `tier_channel_allocations`, `tier_channel_sales` with UPSERT
  uniqueness on `(event_id, tier_name, channel_id)` and RLS.

### Server / lib

- `lib/db/tier-channels.ts` — CRUD helpers, revenue auto-compute,
  per-event channel breakdown aggregation (`buildTierChannelBreakdownMap`).
- `lib/dashboard/currency.ts` — single-source currency utilities
  (`formatCurrency`, `currencySymbol`, `autoComputeRevenue`).
- `lib/dashboard/master-allocations-parser.ts` — XLSX parser with
  per-tab dynamic channel detection.
- `lib/db/ticketing.ts` — `EventTicketTierRow.channel_breakdowns`.
- `lib/db/client-portal-server.ts` — fetches channels +
  allocations + sales for the venue events and attaches
  `channel_breakdowns` to each tier (4TF falls back to
  `event_ticket_tiers.quantity_sold` when no explicit sale row
  exists, so existing data shows immediately without an import run).

### API routes

- `app/api/admin/4thefans-allocation-import/route.ts` — POST
  multipart, service-role import.
- `app/api/share/venue/[token]/{budget,tier-channels{,/allocation,/sale}}/route.ts`
  — share-token CRUD, gated on `can_edit`.
- `app/api/events/[id]/tier-channels{,/allocation,/sale}/route.ts` —
  internal cookie-auth CRUD mirror.

### UI

- `components/dashboard/events/multi-channel-ticket-entry-card.tsx`
  — channel comparison summary + per-tier per-channel inline-edit
  with revenue auto-compute + override toggle.
- `components/share/venue-budget-click-edit.tsx` — venue-header
  per-event budget popover.
- `components/share/venue-full-report.tsx` — wires the new card +
  budget click-edit + share-mode `AdditionalEntriesPanel`. Legacy
  ticket entries panel kept on the internal surface only.
- `components/dashboard/events/venue-additional-spend-card.tsx` —
  optional `shareToken` prop reroutes to the share-token spend
  endpoint.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint` on all touched/new files (clean — pre-existing
      lint errors elsewhere are not in this PR's scope).
- [ ] `npm run build` (deferred to Vercel CI; tsc + eslint cover the
      new surfaces locally).

## Acceptance runbook

1. **Import seed data** (one-shot, admin):
   ```bash
   curl -X POST \
     -H "x-admin-key: ${ADMIN_KEY}" \
     -F "file=@MASTER Allocations.xlsx" \
     "${HOST}/api/admin/4thefans-allocation-import"
   ```
   Expect a 200 with channels_created + allocations_written +
   sales_written counts.
2. Open Brighton share report:
   `/share/client/E8bYmoAxttBNWy3o/venues/WC26-BRIGHTON?tab=performance`
   - Channel comparison summary shows 4TF / SeeTickets / CP totals.
   - Croatia GA Earlybird tier shows 4TF / SeeTickets / CP rows +
     a TOTAL row matching the Brighton tab in the workbook.
3. Click a manual channel cell (e.g. SeeTickets sold) → edit → blur:
   - The row UPSERTs and the tier TOTAL updates without refresh.
4. Toggle "override revenue" on a SeeTickets sold row, type £290
   when `tickets_sold × price = £300`:
   - The `(i)` icon shows a tooltip with the £300 default.
   - Refresh persists override.
5. Click the venue-header marketing total → popover lists each
   event with an inline input → blur saves via the share-token
   budget route → header total recalculates.

## Goals coverage check

| # | Goal | Status |
|---|------|--------|
| 1 | Replace running-total model with multi-channel | ✅ migrations 076/077 + UI card |
| 2 | Automatic channels (4TF/Eventbrite) auto-populate | ✅ `applyTierChannelBreakdowns` falls back to `event_ticket_tiers.quantity_sold` when no explicit sale exists |
| 3 | Manual channels = snapshot UPSERT | ✅ unique key on `(event_id, tier_name, channel_id)` |
| 4 | Per-channel allocation editable + xlsx seed | ✅ admin route + inline edit |
| 5 | Per-tier per-channel display + aggregate totals | ✅ `MultiChannelTicketEntryCard` renders rows + TOTAL footer + summary above |
| 6 | Marketing budget inline-editable on venue report | ✅ `VenueBudgetClickEdit` + share-token `/budget` PATCH |
| 7 | Tier-level granularity for ticket entries | ✅ multi-channel card carries tier picker per row |
| 8 | Revenue auto-compute from price × sold + override | ✅ `autoComputeRevenue` + `revenue_overridden` column + `(i)` tooltip |
| 9 | Currency safety (events.currency → clients.default → GBP) | ✅ `currency.ts` resolver, defaults to GBP |

## Notes / follow-ups

- The internal-side budget editing isn't wired in this PR — the
  click-edit calls the share-token route. Internal users can still
  edit per-event budgets via the existing event detail page; an
  internal endpoint can be added in a follow-up if useful.
- Channel-level pacing math (suggested allocation moves) and a
  frontend XLSX upload UI are out of scope per the original ticket.
- The Brighton sold-import skip is encoded in the parser; if the
  workbook's CP column gets cleaned up the skip can be removed and
  re-imported idempotently.
