# Session log — per-link API base override for 4TheFans

## PR

- **Number:** 305
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/305
- **Branch:** `thread/fourthefans-per-link-api-base`

## Summary

4TheFans (client 37906506) now hosts events across two WordPress booking sites sharing one bearer token — `4thefans.book.tickets` (default) and `wearefootballfestival.book.tickets` (Manchester WC26 Depot Mayfield). Added an `external_api_base text` column on `event_ticketing_links` (Option A / per-link override) so existing links continue hitting the default and Manchester links can be pointed at the new site with a single `UPDATE`. All three sync paths (manual `/api/ticketing/sync`, cron `/api/cron/sync-ticketing`, and `fetchFourthefansRollupSnapshotContribution` inside the rollup runner) now read `link.external_api_base` and pass it as a per-call `apiBase` option to the 4TheFans HTTP client. The Ticketing tab on the client page gains a "Custom API endpoints" section that lists any links using a non-default base URL.

## Scope / files

- `supabase/migrations/083_event_ticketing_links_external_api_base.sql` — new column
- `lib/ticketing/types.ts` — `external_api_base` on `EventTicketingLink`; optional `options.apiBase` on `TicketingProvider.getEventSales`
- `lib/ticketing/fourthefans/client.ts` — `apiBase` option on `FourthefansFetchOptions`; `getBaseUrl` / `buildUrl` accept override
- `lib/ticketing/fourthefans/provider.ts` — `getEventSales` + `fetchEventByExternalId` accept and forward `apiBase`
- `lib/db/ticketing.ts` — `externalApiBase` on `UpsertLinkInput`; written in `upsertEventLink`
- `app/api/ticketing/sync/route.ts` — passes `link.external_api_base` to `getEventSales`
- `app/api/cron/sync-ticketing/route.ts` — passes `link.external_api_base` to `getEventSales`
- `lib/dashboard/rollup-sync-runner.ts` — `externalApiBase` threaded through `fetchFourthefansRollupSnapshotContribution`
- `components/dashboard/clients/ticketing-connections-panel.tsx` — new "Custom API endpoints" section
- `components/dashboard/clients/client-detail.tsx` — `ticketingCustomApiBaseLinks` prop thread-through
- `app/(dashboard)/clients/[id]/page.tsx` — fetches `external_api_base` on links; builds `customApiBaseLinks`

## Validation

- [x] `npx tsc --noEmit` — only pre-existing test-file errors, no new errors
- [ ] Deploy migration 083 via Supabase dashboard
- [ ] After deploy: `UPDATE event_ticketing_links SET external_api_base = 'https://wearefootballfestival.book.tickets/wp-json/agency/v1' WHERE event_id IN (SELECT id FROM events WHERE event_code LIKE 'WC26-MANCHESTER%') AND connection_id = '<4thefans-connection-id>';`
- [ ] Refresh `/clients/37906506-56b7-4d58-ab62-1b042e2b561a/venues/WC26-MANCHESTER` → tickets pull from wearefootballfestival.book.tickets
- [ ] Other 4tF links unaffected (external_api_base = NULL → default)
- [ ] Ticketing tab shows "Custom API endpoints" section listing Manchester events

## Notes

- Option A (per-link) was chosen over Option B (per-connection) — fewer constraint changes, no new connection rows needed since the same bearer token works across both sites.
- The 4TheFans `validateCredentials` call in the connections panel still hits the default base. If the new site needs its own discovery run, pass `apiBase` there too in a follow-up.
- `listAllEvents` (used in link discovery) always hits the default base — a future enhancement could accept a per-discovery apiBase if needed.
