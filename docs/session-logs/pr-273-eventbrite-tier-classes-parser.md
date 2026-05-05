# Session log

## PR

- **Number:** 273
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/273
- **Branch:** `feat/eventbrite-tier-classes-parser`

## Summary

Parse Eventbrite `ticket_classes[]` into the shared `event_ticket_tiers` model so linked Eventbrite events get tier rows, capacity recomputes, and existing sold-out tier UI can render from the same data as 4thefans.

## Scope / files

- Eventbrite ticket class parser and provider sync payload.
- Shared ticket tier persistence and capacity logging.
- Manual sync, cron sync, and rollup sync tier persistence.
- Admin backfill route for latest Eventbrite ticket snapshots.
- Parser regression tests.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [x] `npm test -- --test-name-pattern='parseEventbriteTiers|suggestedPct'`
- [x] `npx eslint lib/ticketing/eventbrite/parse.ts lib/ticketing/eventbrite/provider.ts lib/db/ticketing.ts app/api/ticketing/sync/route.ts app/api/cron/sync-ticketing/route.ts lib/dashboard/rollup-sync-runner.ts app/api/admin/eventbrite-tier-backfill/route.ts lib/ticketing/__tests__/eventbrite-provider.test.ts`

## Notes

No schema migration is required; this reuses `event_ticket_tiers`. Full `npm run lint` is blocked by existing repo-wide errors outside this PR.
