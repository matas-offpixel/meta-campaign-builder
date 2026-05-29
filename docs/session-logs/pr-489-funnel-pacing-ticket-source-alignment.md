# Session log — funnel-pacing ticket-source alignment

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/funnel-pacing-ticket-source-alignment`

## Summary

Aligned the Funnel Pacing tab's "tickets sold" input to the same
MAX-across-sources resolution already used by the Performance tab
(`resolveDisplayTicketCount`).  Prior to this change both pages summed
`events.tickets_sold` directly, missing multi-channel sales captured in
`tier_channel_sales`.  Live undercounts of 8–59% confirmed for five
WC26 venues via Supabase MCP.

## Scope / files

- `lib/dashboard/venue-tickets-sold.ts` — new `resolveVenueTicketsSold` helper
- `lib/dashboard/__tests__/venue-tickets-sold.test.ts` — 10 unit tests
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — internal venue page wired
- `app/share/venue/[token]/page.tsx` — share-link page wired

## Validation

- [x] `eslint` — zero issues on changed files
- [x] `node --experimental-strip-types --test lib/dashboard/__tests__/*.test.ts` — 511/511 pass
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`

## Notes

No new Supabase queries required — `tier_channel_sales_tickets` and
`latest_snapshot.tickets_sold` are already in the portal payload from
`loadVenuePortalByCode` / `loadVenuePortalByToken`.  The canonical funnel
builder (`buildVenueCanonicalFunnel`) receives the corrected `ticketsSold`
value and requires no internal changes.
