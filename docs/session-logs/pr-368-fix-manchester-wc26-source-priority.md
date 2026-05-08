# Session log — fix/manchester-wc26-source-priority

## PR

- **Number:** #368
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/368
- **Branch:** `fix/manchester-wc26-source-priority`

## Summary

Manchester WC26 had richer channel-level ticket data than the latest
fourthefans snapshots (1,006 tier-channel tickets vs 699 snapshot tickets).
The collapsed dashboard/topline paths still preferred snapshots, while the
expanded tier rows used tier/channel data. This PR centralises display
resolution as `max(snapshot, tier-channel union, fallback)` for tickets and
`max(snapshot revenue, tier-channel revenue)` for revenue so the dashboard
uses the fuller source without changing source-priority collapse rules.

## Scope

- `lib/dashboard/tier-channel-rollups.ts` — add
  `resolveDisplayTicketCount` and make revenue prefer the larger of
  snapshot/tier-channel totals when both exist.
- `lib/db/client-dashboard-aggregations.ts` — use the resolver for client
  toplines, venue group totals, campaign cards, and WoW current edge.
- `lib/dashboard/portal-event-spend-row.ts` — use the resolver for expanded
  per-event rows.
- Share/dashboard components that render direct venue totals now use the same
  resolver.
- `lib/dashboard/__tests__/event-tickets-resolver.test.ts` — covers snapshot
  wins, tier-channel wins, empty tier fallback, and revenue max cases.

## Validation

- [x] Focused tests pass:
  `npm test -- lib/dashboard/__tests__/event-tickets-resolver.test.ts lib/dashboard/__tests__/resolve-display-ticket-revenue.test.ts lib/db/__tests__/client-dashboard-aggregations.test.ts lib/dashboard/__tests__/funnel-aggregations.test.ts`
- [x] `npm run build` clean.
- [x] No lint diagnostics on changed files.
- [x] Live Manchester diagnostic via service-role:
  snapshot tickets 699, tier-channel tickets 1,006, tier-channel revenue
  £9,201, resolved tickets 1,006, resolved revenue £9,201.

## Notes

- This does not change `lib/db/event-history-collapse.ts` source priority
  order (`manual > xlsx_import > eventbrite > fourthefans`). It only changes
  the dashboard display resolver when `tier_channel_sales` has a strictly
  fuller union than the latest snapshot.
