## PR

- **Number:** 252
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/252
- **Branch:** `fix/4thefans-discovery-column-name`

## Summary

Fixes the 4thefans link discovery regression from PR #250 by selecting the real `event_ticketing_links.connection_id` column instead of the nonexistent `ticketing_connection_id`.

## Scope / files

- Updates the discovery route linked-external-event lookup to use `connection_id`
- Confirms no other `ticketing_connection_id` references remain

## Validation

- [x] `rg "ticketing_connection_id"`
- [x] `npx tsc --noEmit`
- [x] `npx eslint "app/api/clients/[id]/ticketing-link-discovery/route.ts" "lib/ticketing/event-search.ts" "lib/ticketing/__tests__/event-search.test.ts"`
- [x] `node --test lib/ticketing/__tests__/event-search.test.ts`

## Notes

This is a server-side column-name fix only. Search and auto-pick behavior are otherwise unchanged.
