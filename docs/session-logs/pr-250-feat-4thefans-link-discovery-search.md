## PR

- **Number:** 250
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/250
- **Branch:** `feat/4thefans-link-discovery-search`

## Summary

Adds a client-side 4thefans event search fallback to the link discovery table so operators can manually select provider events that auto-matching does not surface.

## Scope / files

- Returns unlinked external ticketing events from the existing discovery provider sweep
- Adds a pure `searchTicketingEvents` helper for name / venue / date / ID matching
- Adds per-row "Or search" inputs below the auto-pick dropdown
- Allows search-picked events to use the existing selection state and bulk-link button
- Adds search regression coverage for Tottenham event IDs 4012, 4206, 4218, and 4239

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "app/api/clients/[id]/ticketing-link-discovery/route.ts" "components/dashboard/clients/ticketing-link-discovery.tsx" "lib/ticketing/event-search.ts" "lib/ticketing/__tests__/event-search.test.ts"`
- [x] `node --test lib/ticketing/__tests__/event-search.test.ts lib/ticketing/__tests__/link-discovery.test.ts`

## Notes

Did not implement the optional browse-all modal in this pass; the row-level search covers direct name, venue, date, and event ID lookup without extra API calls.
