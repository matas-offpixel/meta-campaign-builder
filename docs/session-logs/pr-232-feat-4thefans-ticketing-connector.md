## PR

- **Number:** 232
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/232
- **Branch:** `feat/4thefans-ticketing-connector`

## Summary

Adds the native 4thefans booking API connector so clients can save encrypted agency API keys, link external events, sync live ticket totals into snapshots and daily rollups, and preserve the dashboard's existing source-priority rules.

## Scope / files

- `lib/ticketing/fourthefans/*` implements the bearer-auth API client, parser, and provider.
- `components/dashboard/clients/*` and `components/dashboard/events/*` enable 4thefans connection/linking alongside Eventbrite.
- `lib/dashboard/rollup-sync-runner.ts`, `lib/db/ticketing.ts`, and source-priority helpers wire 4thefans into sync/storage.
- `supabase/migrations/068_ticket_sales_snapshots_fourthefans_source.sql` allows `ticket_sales_snapshots.source = 'fourthefans'`.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (not run)
- [x] `npm test`
- [x] `npx eslint ...` on branch-touched files

## Notes

The live API probe could not be completed because no issued 4thefans bearer token was present in the local env. The provider supports the documented `/events` and `/events/{event_id}` endpoints and parser tests cover the expected field names/date strings, but the PR body should call out that live response confirmation remains pending.
