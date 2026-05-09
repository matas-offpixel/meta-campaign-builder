# Session log

## PR

- **Number:** 372
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/372
- **Branch:** `fix/resolver-read-tier-channel-sales`

## Summary

`resolveDisplayTicketCount` was missing `tier_channel_sales` as an input. For Manchester WC26 both `event_ticket_tiers.quantity_sold` and `latest_snapshot_tickets` trace back to the 4TF connector (same source = 699), so `Math.max` returned 699 instead of 1,362 — the true total that includes Venue channel tickets recorded in `tier_channel_sales`. The fix adds a `tier_channel_sales_sum` field to `PortalEvent`, populates it in `loadPortalForClientId` by summing the already-fetched `tierChannelSales` rows per event, extends both resolver signatures to accept it, and threads it through all 9 call-sites. Also adds `tier_channel_sales_revenue` for the revenue resolver.

## Scope / files

- `lib/dashboard/tier-channel-rollups.ts` — `resolveDisplayTicketCount` + `resolveDisplayTicketRevenue` extended with new optional inputs; `Math.max` updated
- `lib/db/client-portal-server.ts` — `PortalEvent` gets `tier_channel_sales_tickets` + `tier_channel_sales_revenue`; `loadPortalForClientId` builds `tierChannelSalesTicketsByEvent` / `tierChannelSalesRevenueByEvent` maps and populates per-event
- `lib/db/client-dashboard-aggregations.ts` — `AggregatableEvent` updated; `ticketsForAggregatableEvent` + `ticketRevenueForAggregatableEvent` pass new fields
- `lib/dashboard/portal-event-spend-row.ts` — both resolver calls updated
- `lib/dashboard/funnel-aggregations.ts` — resolver call updated
- `components/share/client-portal-venue-table.tsx` — 2 resolver calls updated
- `components/share/venue-event-breakdown.tsx` — 2 resolver calls updated
- `components/share/venue-daily-report-block.tsx` — 2 resolver calls updated
- `components/share/client-portal.tsx` — 1 resolver call updated
- `components/share/venue-full-report.tsx` — 1 resolver call updated
- `lib/dashboard/__tests__/event-tickets-resolver.test.ts` — 3 new unit tests for Manchester regression + null-safety
- `lib/dashboard/__tests__/manchester-venue-ticket-pipeline.test.ts` — NEW: end-to-end pipeline integration tests (data-loader aggregation → resolver → venue total)

## Validation

- [x] No lint errors in changed files (`npx eslint` on all modified paths: 0 problems)
- [x] `npm run build` — exit 0, clean build
- [x] `npm test` — exit 0, all 7 new tests green

## Notes

**Outernet double-count investigation:** The task hypothesised that Outernet's 1,351 display might double-count due to 2 link IDs (presale + gen-sale). Analysis: `tier_channel_sales` upsert key is `(event_id, tier_name, channel_id)`. A second import run for the same link ID overwrites the existing row — no additive duplicate. Different tier-name variants (e.g. "GA [presale]" vs "GA") represent genuinely separate ticket pools and should be summed. Raw SUM per event_id is correct; no deduplication needed. Documented inline in `client-portal-server.ts`.

**Math.max safety:** `tier_channel_sales_sum` is a Math.max _candidate_, not an override. Outernet's existing display (1,351) is already ≥ its `tier_channel_sales` sum because `tierSalesRollup` already threads Venue channel rows through `channel_breakdowns`. Math.max cannot regress Outernet — it can only surface Manchester's true 1,362 total.

**Lesson anchor:** `feedback_resolver_dashboard_test_gap.md` — "Resolver-level tests are not dashboard-level tests." See inline docblock in `manchester-venue-ticket-pipeline.test.ts` for the tracked Playwright follow-up.

**Verify after merge (DevTools):** Hard-refresh `/clients/37906506-56b7-4d58-ab62-1b042e2b561a/dashboard`. Manchester WC26 (Depot Mayfield) venue card Tickets pill should read `1,362 / 13,538 SOLD`. CL Final London venues (Outernet 1,351/1,357 etc.) must be unchanged.
